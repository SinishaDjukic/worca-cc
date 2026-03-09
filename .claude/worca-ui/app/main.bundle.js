var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/xterm/lib/xterm.js
var require_xterm = __commonJS({
  "node_modules/xterm/lib/xterm.js"(exports, module) {
    !(function(e10, t6) {
      if ("object" == typeof exports && "object" == typeof module) module.exports = t6();
      else if ("function" == typeof define && define.amd) define([], t6);
      else {
        var i8 = t6();
        for (var s4 in i8) ("object" == typeof exports ? exports : e10)[s4] = i8[s4];
      }
    })(self, (() => (() => {
      "use strict";
      var e10 = { 4567: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.AccessibilityManager = void 0;
        const n6 = i9(9042), o10 = i9(6114), a4 = i9(9924), h4 = i9(844), c5 = i9(5596), l6 = i9(4725), d3 = i9(3656);
        let _3 = t7.AccessibilityManager = class extends h4.Disposable {
          constructor(e12, t8) {
            super(), this._terminal = e12, this._renderService = t8, this._liveRegionLineCount = 0, this._charsToConsume = [], this._charsToAnnounce = "", this._accessibilityContainer = document.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = document.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
            for (let e13 = 0; e13 < this._terminal.rows; e13++) this._rowElements[e13] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e13]);
            if (this._topBoundaryFocusListener = (e13) => this._handleBoundaryFocus(e13, 0), this._bottomBoundaryFocusListener = (e13) => this._handleBoundaryFocus(e13, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions(), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = document.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this.register(new a4.TimeBasedDebouncer(this._renderRows.bind(this))), !this._terminal.element) throw new Error("Cannot enable accessibility before Terminal.open");
            this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this.register(this._terminal.onResize(((e13) => this._handleResize(e13.rows)))), this.register(this._terminal.onRender(((e13) => this._refreshRows(e13.start, e13.end)))), this.register(this._terminal.onScroll((() => this._refreshRows()))), this.register(this._terminal.onA11yChar(((e13) => this._handleChar(e13)))), this.register(this._terminal.onLineFeed((() => this._handleChar("\n")))), this.register(this._terminal.onA11yTab(((e13) => this._handleTab(e13)))), this.register(this._terminal.onKey(((e13) => this._handleKey(e13.key)))), this.register(this._terminal.onBlur((() => this._clearLiveRegion()))), this.register(this._renderService.onDimensionsChange((() => this._refreshRowsDimensions()))), this._screenDprMonitor = new c5.ScreenDprMonitor(window), this.register(this._screenDprMonitor), this._screenDprMonitor.setListener((() => this._refreshRowsDimensions())), this.register((0, d3.addDisposableDomListener)(window, "resize", (() => this._refreshRowsDimensions()))), this._refreshRows(), this.register((0, h4.toDisposable)((() => {
              this._accessibilityContainer.remove(), this._rowElements.length = 0;
            })));
          }
          _handleTab(e12) {
            for (let t8 = 0; t8 < e12; t8++) this._handleChar(" ");
          }
          _handleChar(e12) {
            this._liveRegionLineCount < 21 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e12 && (this._charsToAnnounce += e12) : this._charsToAnnounce += e12, "\n" === e12 && (this._liveRegionLineCount++, 21 === this._liveRegionLineCount && (this._liveRegion.textContent += n6.tooMuchOutput)), o10.isMac && this._liveRegion.textContent && this._liveRegion.textContent.length > 0 && !this._liveRegion.parentNode && setTimeout((() => {
              this._accessibilityContainer.appendChild(this._liveRegion);
            }), 0));
          }
          _clearLiveRegion() {
            this._liveRegion.textContent = "", this._liveRegionLineCount = 0, o10.isMac && this._liveRegion.remove();
          }
          _handleKey(e12) {
            this._clearLiveRegion(), /\p{Control}/u.test(e12) || this._charsToConsume.push(e12);
          }
          _refreshRows(e12, t8) {
            this._liveRegionDebouncer.refresh(e12, t8, this._terminal.rows);
          }
          _renderRows(e12, t8) {
            const i10 = this._terminal.buffer, s6 = i10.lines.length.toString();
            for (let r12 = e12; r12 <= t8; r12++) {
              const e13 = i10.translateBufferLineToString(i10.ydisp + r12, true), t9 = (i10.ydisp + r12 + 1).toString(), n7 = this._rowElements[r12];
              n7 && (0 === e13.length ? n7.innerText = "\xA0" : n7.textContent = e13, n7.setAttribute("aria-posinset", t9), n7.setAttribute("aria-setsize", s6));
            }
            this._announceCharacters();
          }
          _announceCharacters() {
            0 !== this._charsToAnnounce.length && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
          }
          _handleBoundaryFocus(e12, t8) {
            const i10 = e12.target, s6 = this._rowElements[0 === t8 ? 1 : this._rowElements.length - 2];
            if (i10.getAttribute("aria-posinset") === (0 === t8 ? "1" : `${this._terminal.buffer.lines.length}`)) return;
            if (e12.relatedTarget !== s6) return;
            let r12, n7;
            if (0 === t8 ? (r12 = i10, n7 = this._rowElements.pop(), this._rowContainer.removeChild(n7)) : (r12 = this._rowElements.shift(), n7 = i10, this._rowContainer.removeChild(r12)), r12.removeEventListener("focus", this._topBoundaryFocusListener), n7.removeEventListener("focus", this._bottomBoundaryFocusListener), 0 === t8) {
              const e13 = this._createAccessibilityTreeNode();
              this._rowElements.unshift(e13), this._rowContainer.insertAdjacentElement("afterbegin", e13);
            } else {
              const e13 = this._createAccessibilityTreeNode();
              this._rowElements.push(e13), this._rowContainer.appendChild(e13);
            }
            this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(0 === t8 ? -1 : 1), this._rowElements[0 === t8 ? 1 : this._rowElements.length - 2].focus(), e12.preventDefault(), e12.stopImmediatePropagation();
          }
          _handleResize(e12) {
            this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
            for (let e13 = this._rowContainer.children.length; e13 < this._terminal.rows; e13++) this._rowElements[e13] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e13]);
            for (; this._rowElements.length > e12; ) this._rowContainer.removeChild(this._rowElements.pop());
            this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
          }
          _createAccessibilityTreeNode() {
            const e12 = document.createElement("div");
            return e12.setAttribute("role", "listitem"), e12.tabIndex = -1, this._refreshRowDimensions(e12), e12;
          }
          _refreshRowsDimensions() {
            if (this._renderService.dimensions.css.cell.height) {
              this._accessibilityContainer.style.width = `${this._renderService.dimensions.css.canvas.width}px`, this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
              for (let e12 = 0; e12 < this._terminal.rows; e12++) this._refreshRowDimensions(this._rowElements[e12]);
            }
          }
          _refreshRowDimensions(e12) {
            e12.style.height = `${this._renderService.dimensions.css.cell.height}px`;
          }
        };
        t7.AccessibilityManager = _3 = s5([r11(1, l6.IRenderService)], _3);
      }, 3614: (e11, t7) => {
        function i9(e12) {
          return e12.replace(/\r?\n/g, "\r");
        }
        function s5(e12, t8) {
          return t8 ? "\x1B[200~" + e12 + "\x1B[201~" : e12;
        }
        function r11(e12, t8, r12, n7) {
          e12 = s5(e12 = i9(e12), r12.decPrivateModes.bracketedPasteMode && true !== n7.rawOptions.ignoreBracketedPasteMode), r12.triggerDataEvent(e12, true), t8.value = "";
        }
        function n6(e12, t8, i10) {
          const s6 = i10.getBoundingClientRect(), r12 = e12.clientX - s6.left - 10, n7 = e12.clientY - s6.top - 10;
          t8.style.width = "20px", t8.style.height = "20px", t8.style.left = `${r12}px`, t8.style.top = `${n7}px`, t8.style.zIndex = "1000", t8.focus();
        }
        Object.defineProperty(t7, "__esModule", { value: true }), t7.rightClickHandler = t7.moveTextAreaUnderMouseCursor = t7.paste = t7.handlePasteEvent = t7.copyHandler = t7.bracketTextForPaste = t7.prepareTextForTerminal = void 0, t7.prepareTextForTerminal = i9, t7.bracketTextForPaste = s5, t7.copyHandler = function(e12, t8) {
          e12.clipboardData && e12.clipboardData.setData("text/plain", t8.selectionText), e12.preventDefault();
        }, t7.handlePasteEvent = function(e12, t8, i10, s6) {
          e12.stopPropagation(), e12.clipboardData && r11(e12.clipboardData.getData("text/plain"), t8, i10, s6);
        }, t7.paste = r11, t7.moveTextAreaUnderMouseCursor = n6, t7.rightClickHandler = function(e12, t8, i10, s6, r12) {
          n6(e12, t8, i10), r12 && s6.rightClickSelect(e12), t8.value = s6.selectionText, t8.select();
        };
      }, 7239: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.ColorContrastCache = void 0;
        const s5 = i9(1505);
        t7.ColorContrastCache = class {
          constructor() {
            this._color = new s5.TwoKeyMap(), this._css = new s5.TwoKeyMap();
          }
          setCss(e12, t8, i10) {
            this._css.set(e12, t8, i10);
          }
          getCss(e12, t8) {
            return this._css.get(e12, t8);
          }
          setColor(e12, t8, i10) {
            this._color.set(e12, t8, i10);
          }
          getColor(e12, t8) {
            return this._color.get(e12, t8);
          }
          clear() {
            this._color.clear(), this._css.clear();
          }
        };
      }, 3656: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.addDisposableDomListener = void 0, t7.addDisposableDomListener = function(e12, t8, i9, s5) {
          e12.addEventListener(t8, i9, s5);
          let r11 = false;
          return { dispose: () => {
            r11 || (r11 = true, e12.removeEventListener(t8, i9, s5));
          } };
        };
      }, 6465: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Linkifier2 = void 0;
        const n6 = i9(3656), o10 = i9(8460), a4 = i9(844), h4 = i9(2585);
        let c5 = t7.Linkifier2 = class extends a4.Disposable {
          get currentLink() {
            return this._currentLink;
          }
          constructor(e12) {
            super(), this._bufferService = e12, this._linkProviders = [], this._linkCacheDisposables = [], this._isMouseOut = true, this._wasResized = false, this._activeLine = -1, this._onShowLinkUnderline = this.register(new o10.EventEmitter()), this.onShowLinkUnderline = this._onShowLinkUnderline.event, this._onHideLinkUnderline = this.register(new o10.EventEmitter()), this.onHideLinkUnderline = this._onHideLinkUnderline.event, this.register((0, a4.getDisposeArrayDisposable)(this._linkCacheDisposables)), this.register((0, a4.toDisposable)((() => {
              this._lastMouseEvent = void 0;
            }))), this.register(this._bufferService.onResize((() => {
              this._clearCurrentLink(), this._wasResized = true;
            })));
          }
          registerLinkProvider(e12) {
            return this._linkProviders.push(e12), { dispose: () => {
              const t8 = this._linkProviders.indexOf(e12);
              -1 !== t8 && this._linkProviders.splice(t8, 1);
            } };
          }
          attachToDom(e12, t8, i10) {
            this._element = e12, this._mouseService = t8, this._renderService = i10, this.register((0, n6.addDisposableDomListener)(this._element, "mouseleave", (() => {
              this._isMouseOut = true, this._clearCurrentLink();
            }))), this.register((0, n6.addDisposableDomListener)(this._element, "mousemove", this._handleMouseMove.bind(this))), this.register((0, n6.addDisposableDomListener)(this._element, "mousedown", this._handleMouseDown.bind(this))), this.register((0, n6.addDisposableDomListener)(this._element, "mouseup", this._handleMouseUp.bind(this)));
          }
          _handleMouseMove(e12) {
            if (this._lastMouseEvent = e12, !this._element || !this._mouseService) return;
            const t8 = this._positionFromMouseEvent(e12, this._element, this._mouseService);
            if (!t8) return;
            this._isMouseOut = false;
            const i10 = e12.composedPath();
            for (let e13 = 0; e13 < i10.length; e13++) {
              const t9 = i10[e13];
              if (t9.classList.contains("xterm")) break;
              if (t9.classList.contains("xterm-hover")) return;
            }
            this._lastBufferCell && t8.x === this._lastBufferCell.x && t8.y === this._lastBufferCell.y || (this._handleHover(t8), this._lastBufferCell = t8);
          }
          _handleHover(e12) {
            if (this._activeLine !== e12.y || this._wasResized) return this._clearCurrentLink(), this._askForLink(e12, false), void (this._wasResized = false);
            this._currentLink && this._linkAtPosition(this._currentLink.link, e12) || (this._clearCurrentLink(), this._askForLink(e12, true));
          }
          _askForLink(e12, t8) {
            var i10, s6;
            this._activeProviderReplies && t8 || (null === (i10 = this._activeProviderReplies) || void 0 === i10 || i10.forEach(((e13) => {
              null == e13 || e13.forEach(((e14) => {
                e14.link.dispose && e14.link.dispose();
              }));
            })), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e12.y);
            let r12 = false;
            for (const [i11, n7] of this._linkProviders.entries()) t8 ? (null === (s6 = this._activeProviderReplies) || void 0 === s6 ? void 0 : s6.get(i11)) && (r12 = this._checkLinkProviderResult(i11, e12, r12)) : n7.provideLinks(e12.y, ((t9) => {
              var s7, n8;
              if (this._isMouseOut) return;
              const o11 = null == t9 ? void 0 : t9.map(((e13) => ({ link: e13 })));
              null === (s7 = this._activeProviderReplies) || void 0 === s7 || s7.set(i11, o11), r12 = this._checkLinkProviderResult(i11, e12, r12), (null === (n8 = this._activeProviderReplies) || void 0 === n8 ? void 0 : n8.size) === this._linkProviders.length && this._removeIntersectingLinks(e12.y, this._activeProviderReplies);
            }));
          }
          _removeIntersectingLinks(e12, t8) {
            const i10 = /* @__PURE__ */ new Set();
            for (let s6 = 0; s6 < t8.size; s6++) {
              const r12 = t8.get(s6);
              if (r12) for (let t9 = 0; t9 < r12.length; t9++) {
                const s7 = r12[t9], n7 = s7.link.range.start.y < e12 ? 0 : s7.link.range.start.x, o11 = s7.link.range.end.y > e12 ? this._bufferService.cols : s7.link.range.end.x;
                for (let e13 = n7; e13 <= o11; e13++) {
                  if (i10.has(e13)) {
                    r12.splice(t9--, 1);
                    break;
                  }
                  i10.add(e13);
                }
              }
            }
          }
          _checkLinkProviderResult(e12, t8, i10) {
            var s6;
            if (!this._activeProviderReplies) return i10;
            const r12 = this._activeProviderReplies.get(e12);
            let n7 = false;
            for (let t9 = 0; t9 < e12; t9++) this._activeProviderReplies.has(t9) && !this._activeProviderReplies.get(t9) || (n7 = true);
            if (!n7 && r12) {
              const e13 = r12.find(((e14) => this._linkAtPosition(e14.link, t8)));
              e13 && (i10 = true, this._handleNewLink(e13));
            }
            if (this._activeProviderReplies.size === this._linkProviders.length && !i10) for (let e13 = 0; e13 < this._activeProviderReplies.size; e13++) {
              const r13 = null === (s6 = this._activeProviderReplies.get(e13)) || void 0 === s6 ? void 0 : s6.find(((e14) => this._linkAtPosition(e14.link, t8)));
              if (r13) {
                i10 = true, this._handleNewLink(r13);
                break;
              }
            }
            return i10;
          }
          _handleMouseDown() {
            this._mouseDownLink = this._currentLink;
          }
          _handleMouseUp(e12) {
            if (!this._element || !this._mouseService || !this._currentLink) return;
            const t8 = this._positionFromMouseEvent(e12, this._element, this._mouseService);
            t8 && this._mouseDownLink === this._currentLink && this._linkAtPosition(this._currentLink.link, t8) && this._currentLink.link.activate(e12, this._currentLink.link.text);
          }
          _clearCurrentLink(e12, t8) {
            this._element && this._currentLink && this._lastMouseEvent && (!e12 || !t8 || this._currentLink.link.range.start.y >= e12 && this._currentLink.link.range.end.y <= t8) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, (0, a4.disposeArray)(this._linkCacheDisposables));
          }
          _handleNewLink(e12) {
            if (!this._element || !this._lastMouseEvent || !this._mouseService) return;
            const t8 = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
            t8 && this._linkAtPosition(e12.link, t8) && (this._currentLink = e12, this._currentLink.state = { decorations: { underline: void 0 === e12.link.decorations || e12.link.decorations.underline, pointerCursor: void 0 === e12.link.decorations || e12.link.decorations.pointerCursor }, isHovered: true }, this._linkHover(this._element, e12.link, this._lastMouseEvent), e12.link.decorations = {}, Object.defineProperties(e12.link.decorations, { pointerCursor: { get: () => {
              var e13, t9;
              return null === (t9 = null === (e13 = this._currentLink) || void 0 === e13 ? void 0 : e13.state) || void 0 === t9 ? void 0 : t9.decorations.pointerCursor;
            }, set: (e13) => {
              var t9, i10;
              (null === (t9 = this._currentLink) || void 0 === t9 ? void 0 : t9.state) && this._currentLink.state.decorations.pointerCursor !== e13 && (this._currentLink.state.decorations.pointerCursor = e13, this._currentLink.state.isHovered && (null === (i10 = this._element) || void 0 === i10 || i10.classList.toggle("xterm-cursor-pointer", e13)));
            } }, underline: { get: () => {
              var e13, t9;
              return null === (t9 = null === (e13 = this._currentLink) || void 0 === e13 ? void 0 : e13.state) || void 0 === t9 ? void 0 : t9.decorations.underline;
            }, set: (t9) => {
              var i10, s6, r12;
              (null === (i10 = this._currentLink) || void 0 === i10 ? void 0 : i10.state) && (null === (r12 = null === (s6 = this._currentLink) || void 0 === s6 ? void 0 : s6.state) || void 0 === r12 ? void 0 : r12.decorations.underline) !== t9 && (this._currentLink.state.decorations.underline = t9, this._currentLink.state.isHovered && this._fireUnderlineEvent(e12.link, t9));
            } } }), this._renderService && this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange(((e13) => {
              if (!this._currentLink) return;
              const t9 = 0 === e13.start ? 0 : e13.start + 1 + this._bufferService.buffer.ydisp, i10 = this._bufferService.buffer.ydisp + 1 + e13.end;
              if (this._currentLink.link.range.start.y >= t9 && this._currentLink.link.range.end.y <= i10 && (this._clearCurrentLink(t9, i10), this._lastMouseEvent && this._element)) {
                const e14 = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
                e14 && this._askForLink(e14, false);
              }
            }))));
          }
          _linkHover(e12, t8, i10) {
            var s6;
            (null === (s6 = this._currentLink) || void 0 === s6 ? void 0 : s6.state) && (this._currentLink.state.isHovered = true, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t8, true), this._currentLink.state.decorations.pointerCursor && e12.classList.add("xterm-cursor-pointer")), t8.hover && t8.hover(i10, t8.text);
          }
          _fireUnderlineEvent(e12, t8) {
            const i10 = e12.range, s6 = this._bufferService.buffer.ydisp, r12 = this._createLinkUnderlineEvent(i10.start.x - 1, i10.start.y - s6 - 1, i10.end.x, i10.end.y - s6 - 1, void 0);
            (t8 ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(r12);
          }
          _linkLeave(e12, t8, i10) {
            var s6;
            (null === (s6 = this._currentLink) || void 0 === s6 ? void 0 : s6.state) && (this._currentLink.state.isHovered = false, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t8, false), this._currentLink.state.decorations.pointerCursor && e12.classList.remove("xterm-cursor-pointer")), t8.leave && t8.leave(i10, t8.text);
          }
          _linkAtPosition(e12, t8) {
            const i10 = e12.range.start.y * this._bufferService.cols + e12.range.start.x, s6 = e12.range.end.y * this._bufferService.cols + e12.range.end.x, r12 = t8.y * this._bufferService.cols + t8.x;
            return i10 <= r12 && r12 <= s6;
          }
          _positionFromMouseEvent(e12, t8, i10) {
            const s6 = i10.getCoords(e12, t8, this._bufferService.cols, this._bufferService.rows);
            if (s6) return { x: s6[0], y: s6[1] + this._bufferService.buffer.ydisp };
          }
          _createLinkUnderlineEvent(e12, t8, i10, s6, r12) {
            return { x1: e12, y1: t8, x2: i10, y2: s6, cols: this._bufferService.cols, fg: r12 };
          }
        };
        t7.Linkifier2 = c5 = s5([r11(0, h4.IBufferService)], c5);
      }, 9042: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.tooMuchOutput = t7.promptLabel = void 0, t7.promptLabel = "Terminal input", t7.tooMuchOutput = "Too much output to announce, navigate to rows manually to read";
      }, 3730: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.OscLinkProvider = void 0;
        const n6 = i9(511), o10 = i9(2585);
        let a4 = t7.OscLinkProvider = class {
          constructor(e12, t8, i10) {
            this._bufferService = e12, this._optionsService = t8, this._oscLinkService = i10;
          }
          provideLinks(e12, t8) {
            var i10;
            const s6 = this._bufferService.buffer.lines.get(e12 - 1);
            if (!s6) return void t8(void 0);
            const r12 = [], o11 = this._optionsService.rawOptions.linkHandler, a5 = new n6.CellData(), c5 = s6.getTrimmedLength();
            let l6 = -1, d3 = -1, _3 = false;
            for (let t9 = 0; t9 < c5; t9++) if (-1 !== d3 || s6.hasContent(t9)) {
              if (s6.loadCell(t9, a5), a5.hasExtendedAttrs() && a5.extended.urlId) {
                if (-1 === d3) {
                  d3 = t9, l6 = a5.extended.urlId;
                  continue;
                }
                _3 = a5.extended.urlId !== l6;
              } else -1 !== d3 && (_3 = true);
              if (_3 || -1 !== d3 && t9 === c5 - 1) {
                const s7 = null === (i10 = this._oscLinkService.getLinkData(l6)) || void 0 === i10 ? void 0 : i10.uri;
                if (s7) {
                  const i11 = { start: { x: d3 + 1, y: e12 }, end: { x: t9 + (_3 || t9 !== c5 - 1 ? 0 : 1), y: e12 } };
                  let n7 = false;
                  if (!(null == o11 ? void 0 : o11.allowNonHttpProtocols)) try {
                    const e13 = new URL(s7);
                    ["http:", "https:"].includes(e13.protocol) || (n7 = true);
                  } catch (e13) {
                    n7 = true;
                  }
                  n7 || r12.push({ text: s7, range: i11, activate: (e13, t10) => o11 ? o11.activate(e13, t10, i11) : h4(0, t10), hover: (e13, t10) => {
                    var s8;
                    return null === (s8 = null == o11 ? void 0 : o11.hover) || void 0 === s8 ? void 0 : s8.call(o11, e13, t10, i11);
                  }, leave: (e13, t10) => {
                    var s8;
                    return null === (s8 = null == o11 ? void 0 : o11.leave) || void 0 === s8 ? void 0 : s8.call(o11, e13, t10, i11);
                  } });
                }
                _3 = false, a5.hasExtendedAttrs() && a5.extended.urlId ? (d3 = t9, l6 = a5.extended.urlId) : (d3 = -1, l6 = -1);
              }
            }
            t8(r12);
          }
        };
        function h4(e12, t8) {
          if (confirm(`Do you want to navigate to ${t8}?

WARNING: This link could potentially be dangerous`)) {
            const e13 = window.open();
            if (e13) {
              try {
                e13.opener = null;
              } catch (e14) {
              }
              e13.location.href = t8;
            } else console.warn("Opening link blocked as opener could not be cleared");
          }
        }
        t7.OscLinkProvider = a4 = s5([r11(0, o10.IBufferService), r11(1, o10.IOptionsService), r11(2, o10.IOscLinkService)], a4);
      }, 6193: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.RenderDebouncer = void 0, t7.RenderDebouncer = class {
          constructor(e12, t8) {
            this._parentWindow = e12, this._renderCallback = t8, this._refreshCallbacks = [];
          }
          dispose() {
            this._animationFrame && (this._parentWindow.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
          }
          addRefreshCallback(e12) {
            return this._refreshCallbacks.push(e12), this._animationFrame || (this._animationFrame = this._parentWindow.requestAnimationFrame((() => this._innerRefresh()))), this._animationFrame;
          }
          refresh(e12, t8, i9) {
            this._rowCount = i9, e12 = void 0 !== e12 ? e12 : 0, t8 = void 0 !== t8 ? t8 : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e12) : e12, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t8) : t8, this._animationFrame || (this._animationFrame = this._parentWindow.requestAnimationFrame((() => this._innerRefresh())));
          }
          _innerRefresh() {
            if (this._animationFrame = void 0, void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount) return void this._runRefreshCallbacks();
            const e12 = Math.max(this._rowStart, 0), t8 = Math.min(this._rowEnd, this._rowCount - 1);
            this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e12, t8), this._runRefreshCallbacks();
          }
          _runRefreshCallbacks() {
            for (const e12 of this._refreshCallbacks) e12(0);
            this._refreshCallbacks = [];
          }
        };
      }, 5596: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.ScreenDprMonitor = void 0;
        const s5 = i9(844);
        class r11 extends s5.Disposable {
          constructor(e12) {
            super(), this._parentWindow = e12, this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this.register((0, s5.toDisposable)((() => {
              this.clearListener();
            })));
          }
          setListener(e12) {
            this._listener && this.clearListener(), this._listener = e12, this._outerListener = () => {
              this._listener && (this._listener(this._parentWindow.devicePixelRatio, this._currentDevicePixelRatio), this._updateDpr());
            }, this._updateDpr();
          }
          _updateDpr() {
            var e12;
            this._outerListener && (null === (e12 = this._resolutionMediaMatchList) || void 0 === e12 || e12.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
          }
          clearListener() {
            this._resolutionMediaMatchList && this._listener && this._outerListener && (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._listener = void 0, this._outerListener = void 0);
          }
        }
        t7.ScreenDprMonitor = r11;
      }, 3236: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Terminal = void 0;
        const s5 = i9(3614), r11 = i9(3656), n6 = i9(6465), o10 = i9(9042), a4 = i9(3730), h4 = i9(1680), c5 = i9(3107), l6 = i9(5744), d3 = i9(2950), _3 = i9(1296), u4 = i9(428), f3 = i9(4269), v2 = i9(5114), p4 = i9(8934), g2 = i9(3230), m3 = i9(9312), S3 = i9(4725), C3 = i9(6731), b3 = i9(8055), y3 = i9(8969), w2 = i9(8460), E2 = i9(844), k3 = i9(6114), L2 = i9(8437), D2 = i9(2584), R2 = i9(7399), x2 = i9(5941), A3 = i9(9074), B4 = i9(2585), T2 = i9(5435), M3 = i9(4567), O2 = "undefined" != typeof window ? window.document : null;
        class P4 extends y3.CoreTerminal {
          get onFocus() {
            return this._onFocus.event;
          }
          get onBlur() {
            return this._onBlur.event;
          }
          get onA11yChar() {
            return this._onA11yCharEmitter.event;
          }
          get onA11yTab() {
            return this._onA11yTabEmitter.event;
          }
          get onWillOpen() {
            return this._onWillOpen.event;
          }
          constructor(e12 = {}) {
            super(e12), this.browser = k3, this._keyDownHandled = false, this._keyDownSeen = false, this._keyPressHandled = false, this._unprocessedDeadKey = false, this._accessibilityManager = this.register(new E2.MutableDisposable()), this._onCursorMove = this.register(new w2.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onKey = this.register(new w2.EventEmitter()), this.onKey = this._onKey.event, this._onRender = this.register(new w2.EventEmitter()), this.onRender = this._onRender.event, this._onSelectionChange = this.register(new w2.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onTitleChange = this.register(new w2.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onBell = this.register(new w2.EventEmitter()), this.onBell = this._onBell.event, this._onFocus = this.register(new w2.EventEmitter()), this._onBlur = this.register(new w2.EventEmitter()), this._onA11yCharEmitter = this.register(new w2.EventEmitter()), this._onA11yTabEmitter = this.register(new w2.EventEmitter()), this._onWillOpen = this.register(new w2.EventEmitter()), this._setup(), this.linkifier2 = this.register(this._instantiationService.createInstance(n6.Linkifier2)), this.linkifier2.registerLinkProvider(this._instantiationService.createInstance(a4.OscLinkProvider)), this._decorationService = this._instantiationService.createInstance(A3.DecorationService), this._instantiationService.setService(B4.IDecorationService, this._decorationService), this.register(this._inputHandler.onRequestBell((() => this._onBell.fire()))), this.register(this._inputHandler.onRequestRefreshRows(((e13, t8) => this.refresh(e13, t8)))), this.register(this._inputHandler.onRequestSendFocus((() => this._reportFocus()))), this.register(this._inputHandler.onRequestReset((() => this.reset()))), this.register(this._inputHandler.onRequestWindowsOptionsReport(((e13) => this._reportWindowsOptions(e13)))), this.register(this._inputHandler.onColor(((e13) => this._handleColorEvent(e13)))), this.register((0, w2.forwardEvent)(this._inputHandler.onCursorMove, this._onCursorMove)), this.register((0, w2.forwardEvent)(this._inputHandler.onTitleChange, this._onTitleChange)), this.register((0, w2.forwardEvent)(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this.register((0, w2.forwardEvent)(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this.register(this._bufferService.onResize(((e13) => this._afterResize(e13.cols, e13.rows)))), this.register((0, E2.toDisposable)((() => {
              var e13, t8;
              this._customKeyEventHandler = void 0, null === (t8 = null === (e13 = this.element) || void 0 === e13 ? void 0 : e13.parentNode) || void 0 === t8 || t8.removeChild(this.element);
            })));
          }
          _handleColorEvent(e12) {
            if (this._themeService) for (const t8 of e12) {
              let e13, i10 = "";
              switch (t8.index) {
                case 256:
                  e13 = "foreground", i10 = "10";
                  break;
                case 257:
                  e13 = "background", i10 = "11";
                  break;
                case 258:
                  e13 = "cursor", i10 = "12";
                  break;
                default:
                  e13 = "ansi", i10 = "4;" + t8.index;
              }
              switch (t8.type) {
                case 0:
                  const s6 = b3.color.toColorRGB("ansi" === e13 ? this._themeService.colors.ansi[t8.index] : this._themeService.colors[e13]);
                  this.coreService.triggerDataEvent(`${D2.C0.ESC}]${i10};${(0, x2.toRgbString)(s6)}${D2.C1_ESCAPED.ST}`);
                  break;
                case 1:
                  if ("ansi" === e13) this._themeService.modifyColors(((e14) => e14.ansi[t8.index] = b3.rgba.toColor(...t8.color)));
                  else {
                    const i11 = e13;
                    this._themeService.modifyColors(((e14) => e14[i11] = b3.rgba.toColor(...t8.color)));
                  }
                  break;
                case 2:
                  this._themeService.restoreColor(t8.index);
              }
            }
          }
          _setup() {
            super._setup(), this._customKeyEventHandler = void 0;
          }
          get buffer() {
            return this.buffers.active;
          }
          focus() {
            this.textarea && this.textarea.focus({ preventScroll: true });
          }
          _handleScreenReaderModeOptionChange(e12) {
            e12 ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(M3.AccessibilityManager, this)) : this._accessibilityManager.clear();
          }
          _handleTextAreaFocus(e12) {
            this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D2.C0.ESC + "[I"), this.updateCursorStyle(e12), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
          }
          blur() {
            var e12;
            return null === (e12 = this.textarea) || void 0 === e12 ? void 0 : e12.blur();
          }
          _handleTextAreaBlur() {
            this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D2.C0.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
          }
          _syncTextArea() {
            if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService) return;
            const e12 = this.buffer.ybase + this.buffer.y, t8 = this.buffer.lines.get(e12);
            if (!t8) return;
            const i10 = Math.min(this.buffer.x, this.cols - 1), s6 = this._renderService.dimensions.css.cell.height, r12 = t8.getWidth(i10), n7 = this._renderService.dimensions.css.cell.width * r12, o11 = this.buffer.y * this._renderService.dimensions.css.cell.height, a5 = i10 * this._renderService.dimensions.css.cell.width;
            this.textarea.style.left = a5 + "px", this.textarea.style.top = o11 + "px", this.textarea.style.width = n7 + "px", this.textarea.style.height = s6 + "px", this.textarea.style.lineHeight = s6 + "px", this.textarea.style.zIndex = "-5";
          }
          _initGlobal() {
            this._bindKeys(), this.register((0, r11.addDisposableDomListener)(this.element, "copy", ((e13) => {
              this.hasSelection() && (0, s5.copyHandler)(e13, this._selectionService);
            })));
            const e12 = (e13) => (0, s5.handlePasteEvent)(e13, this.textarea, this.coreService, this.optionsService);
            this.register((0, r11.addDisposableDomListener)(this.textarea, "paste", e12)), this.register((0, r11.addDisposableDomListener)(this.element, "paste", e12)), k3.isFirefox ? this.register((0, r11.addDisposableDomListener)(this.element, "mousedown", ((e13) => {
              2 === e13.button && (0, s5.rightClickHandler)(e13, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
            }))) : this.register((0, r11.addDisposableDomListener)(this.element, "contextmenu", ((e13) => {
              (0, s5.rightClickHandler)(e13, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
            }))), k3.isLinux && this.register((0, r11.addDisposableDomListener)(this.element, "auxclick", ((e13) => {
              1 === e13.button && (0, s5.moveTextAreaUnderMouseCursor)(e13, this.textarea, this.screenElement);
            })));
          }
          _bindKeys() {
            this.register((0, r11.addDisposableDomListener)(this.textarea, "keyup", ((e12) => this._keyUp(e12)), true)), this.register((0, r11.addDisposableDomListener)(this.textarea, "keydown", ((e12) => this._keyDown(e12)), true)), this.register((0, r11.addDisposableDomListener)(this.textarea, "keypress", ((e12) => this._keyPress(e12)), true)), this.register((0, r11.addDisposableDomListener)(this.textarea, "compositionstart", (() => this._compositionHelper.compositionstart()))), this.register((0, r11.addDisposableDomListener)(this.textarea, "compositionupdate", ((e12) => this._compositionHelper.compositionupdate(e12)))), this.register((0, r11.addDisposableDomListener)(this.textarea, "compositionend", (() => this._compositionHelper.compositionend()))), this.register((0, r11.addDisposableDomListener)(this.textarea, "input", ((e12) => this._inputEvent(e12)), true)), this.register(this.onRender((() => this._compositionHelper.updateCompositionElements())));
          }
          open(e12) {
            var t8;
            if (!e12) throw new Error("Terminal requires a parent element.");
            e12.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this._document = e12.ownerDocument, this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e12.appendChild(this.element);
            const i10 = O2.createDocumentFragment();
            this._viewportElement = O2.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), i10.appendChild(this._viewportElement), this._viewportScrollArea = O2.createElement("div"), this._viewportScrollArea.classList.add("xterm-scroll-area"), this._viewportElement.appendChild(this._viewportScrollArea), this.screenElement = O2.createElement("div"), this.screenElement.classList.add("xterm-screen"), this._helperContainer = O2.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), i10.appendChild(this.screenElement), this.textarea = O2.createElement("textarea"), this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", o10.promptLabel), k3.isChromeOS || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._coreBrowserService = this._instantiationService.createInstance(v2.CoreBrowserService, this.textarea, null !== (t8 = this._document.defaultView) && void 0 !== t8 ? t8 : window), this._instantiationService.setService(S3.ICoreBrowserService, this._coreBrowserService), this.register((0, r11.addDisposableDomListener)(this.textarea, "focus", ((e13) => this._handleTextAreaFocus(e13)))), this.register((0, r11.addDisposableDomListener)(this.textarea, "blur", (() => this._handleTextAreaBlur()))), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(u4.CharSizeService, this._document, this._helperContainer), this._instantiationService.setService(S3.ICharSizeService, this._charSizeService), this._themeService = this._instantiationService.createInstance(C3.ThemeService), this._instantiationService.setService(S3.IThemeService, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(f3.CharacterJoinerService), this._instantiationService.setService(S3.ICharacterJoinerService, this._characterJoinerService), this._renderService = this.register(this._instantiationService.createInstance(g2.RenderService, this.rows, this.screenElement)), this._instantiationService.setService(S3.IRenderService, this._renderService), this.register(this._renderService.onRenderedViewportChange(((e13) => this._onRender.fire(e13)))), this.onResize(((e13) => this._renderService.resize(e13.cols, e13.rows))), this._compositionView = O2.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance(d3.CompositionHelper, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this.element.appendChild(i10);
            try {
              this._onWillOpen.fire(this.element);
            } catch (e13) {
            }
            this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this._mouseService = this._instantiationService.createInstance(p4.MouseService), this._instantiationService.setService(S3.IMouseService, this._mouseService), this.viewport = this._instantiationService.createInstance(h4.Viewport, this._viewportElement, this._viewportScrollArea), this.viewport.onRequestScrollLines(((e13) => this.scrollLines(e13.amount, e13.suppressScrollEvent, 1))), this.register(this._inputHandler.onRequestSyncScrollBar((() => this.viewport.syncScrollArea()))), this.register(this.viewport), this.register(this.onCursorMove((() => {
              this._renderService.handleCursorMove(), this._syncTextArea();
            }))), this.register(this.onResize((() => this._renderService.handleResize(this.cols, this.rows)))), this.register(this.onBlur((() => this._renderService.handleBlur()))), this.register(this.onFocus((() => this._renderService.handleFocus()))), this.register(this._renderService.onDimensionsChange((() => this.viewport.syncScrollArea()))), this._selectionService = this.register(this._instantiationService.createInstance(m3.SelectionService, this.element, this.screenElement, this.linkifier2)), this._instantiationService.setService(S3.ISelectionService, this._selectionService), this.register(this._selectionService.onRequestScrollLines(((e13) => this.scrollLines(e13.amount, e13.suppressScrollEvent)))), this.register(this._selectionService.onSelectionChange((() => this._onSelectionChange.fire()))), this.register(this._selectionService.onRequestRedraw(((e13) => this._renderService.handleSelectionChanged(e13.start, e13.end, e13.columnSelectMode)))), this.register(this._selectionService.onLinuxMouseSelection(((e13) => {
              this.textarea.value = e13, this.textarea.focus(), this.textarea.select();
            }))), this.register(this._onScroll.event(((e13) => {
              this.viewport.syncScrollArea(), this._selectionService.refresh();
            }))), this.register((0, r11.addDisposableDomListener)(this._viewportElement, "scroll", (() => this._selectionService.refresh()))), this.linkifier2.attachToDom(this.screenElement, this._mouseService, this._renderService), this.register(this._instantiationService.createInstance(c5.BufferDecorationRenderer, this.screenElement)), this.register((0, r11.addDisposableDomListener)(this.element, "mousedown", ((e13) => this._selectionService.handleMouseDown(e13)))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(M3.AccessibilityManager, this)), this.register(this.optionsService.onSpecificOptionChange("screenReaderMode", ((e13) => this._handleScreenReaderModeOptionChange(e13)))), this.options.overviewRulerWidth && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l6.OverviewRulerRenderer, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRulerWidth", ((e13) => {
              !this._overviewRulerRenderer && e13 && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l6.OverviewRulerRenderer, this._viewportElement, this.screenElement)));
            })), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
          }
          _createRenderer() {
            return this._instantiationService.createInstance(_3.DomRenderer, this.element, this.screenElement, this._viewportElement, this.linkifier2);
          }
          bindMouse() {
            const e12 = this, t8 = this.element;
            function i10(t9) {
              const i11 = e12._mouseService.getMouseReportCoords(t9, e12.screenElement);
              if (!i11) return false;
              let s7, r12;
              switch (t9.overrideType || t9.type) {
                case "mousemove":
                  r12 = 32, void 0 === t9.buttons ? (s7 = 3, void 0 !== t9.button && (s7 = t9.button < 3 ? t9.button : 3)) : s7 = 1 & t9.buttons ? 0 : 4 & t9.buttons ? 1 : 2 & t9.buttons ? 2 : 3;
                  break;
                case "mouseup":
                  r12 = 0, s7 = t9.button < 3 ? t9.button : 3;
                  break;
                case "mousedown":
                  r12 = 1, s7 = t9.button < 3 ? t9.button : 3;
                  break;
                case "wheel":
                  if (0 === e12.viewport.getLinesScrolled(t9)) return false;
                  r12 = t9.deltaY < 0 ? 0 : 1, s7 = 4;
                  break;
                default:
                  return false;
              }
              return !(void 0 === r12 || void 0 === s7 || s7 > 4) && e12.coreMouseService.triggerMouseEvent({ col: i11.col, row: i11.row, x: i11.x, y: i11.y, button: s7, action: r12, ctrl: t9.ctrlKey, alt: t9.altKey, shift: t9.shiftKey });
            }
            const s6 = { mouseup: null, wheel: null, mousedrag: null, mousemove: null }, n7 = { mouseup: (e13) => (i10(e13), e13.buttons || (this._document.removeEventListener("mouseup", s6.mouseup), s6.mousedrag && this._document.removeEventListener("mousemove", s6.mousedrag)), this.cancel(e13)), wheel: (e13) => (i10(e13), this.cancel(e13, true)), mousedrag: (e13) => {
              e13.buttons && i10(e13);
            }, mousemove: (e13) => {
              e13.buttons || i10(e13);
            } };
            this.register(this.coreMouseService.onProtocolChange(((e13) => {
              e13 ? ("debug" === this.optionsService.rawOptions.logLevel && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(e13)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), 8 & e13 ? s6.mousemove || (t8.addEventListener("mousemove", n7.mousemove), s6.mousemove = n7.mousemove) : (t8.removeEventListener("mousemove", s6.mousemove), s6.mousemove = null), 16 & e13 ? s6.wheel || (t8.addEventListener("wheel", n7.wheel, { passive: false }), s6.wheel = n7.wheel) : (t8.removeEventListener("wheel", s6.wheel), s6.wheel = null), 2 & e13 ? s6.mouseup || (t8.addEventListener("mouseup", n7.mouseup), s6.mouseup = n7.mouseup) : (this._document.removeEventListener("mouseup", s6.mouseup), t8.removeEventListener("mouseup", s6.mouseup), s6.mouseup = null), 4 & e13 ? s6.mousedrag || (s6.mousedrag = n7.mousedrag) : (this._document.removeEventListener("mousemove", s6.mousedrag), s6.mousedrag = null);
            }))), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this.register((0, r11.addDisposableDomListener)(t8, "mousedown", ((e13) => {
              if (e13.preventDefault(), this.focus(), this.coreMouseService.areMouseEventsActive && !this._selectionService.shouldForceSelection(e13)) return i10(e13), s6.mouseup && this._document.addEventListener("mouseup", s6.mouseup), s6.mousedrag && this._document.addEventListener("mousemove", s6.mousedrag), this.cancel(e13);
            }))), this.register((0, r11.addDisposableDomListener)(t8, "wheel", ((e13) => {
              if (!s6.wheel) {
                if (!this.buffer.hasScrollback) {
                  const t9 = this.viewport.getLinesScrolled(e13);
                  if (0 === t9) return;
                  const i11 = D2.C0.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (e13.deltaY < 0 ? "A" : "B");
                  let s7 = "";
                  for (let e14 = 0; e14 < Math.abs(t9); e14++) s7 += i11;
                  return this.coreService.triggerDataEvent(s7, true), this.cancel(e13, true);
                }
                return this.viewport.handleWheel(e13) ? this.cancel(e13) : void 0;
              }
            }), { passive: false })), this.register((0, r11.addDisposableDomListener)(t8, "touchstart", ((e13) => {
              if (!this.coreMouseService.areMouseEventsActive) return this.viewport.handleTouchStart(e13), this.cancel(e13);
            }), { passive: true })), this.register((0, r11.addDisposableDomListener)(t8, "touchmove", ((e13) => {
              if (!this.coreMouseService.areMouseEventsActive) return this.viewport.handleTouchMove(e13) ? void 0 : this.cancel(e13);
            }), { passive: false }));
          }
          refresh(e12, t8) {
            var i10;
            null === (i10 = this._renderService) || void 0 === i10 || i10.refreshRows(e12, t8);
          }
          updateCursorStyle(e12) {
            var t8;
            (null === (t8 = this._selectionService) || void 0 === t8 ? void 0 : t8.shouldColumnSelect(e12)) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
          }
          _showCursor() {
            this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = true, this.refresh(this.buffer.y, this.buffer.y));
          }
          scrollLines(e12, t8, i10 = 0) {
            var s6;
            1 === i10 ? (super.scrollLines(e12, t8, i10), this.refresh(0, this.rows - 1)) : null === (s6 = this.viewport) || void 0 === s6 || s6.scrollLines(e12);
          }
          paste(e12) {
            (0, s5.paste)(e12, this.textarea, this.coreService, this.optionsService);
          }
          attachCustomKeyEventHandler(e12) {
            this._customKeyEventHandler = e12;
          }
          registerLinkProvider(e12) {
            return this.linkifier2.registerLinkProvider(e12);
          }
          registerCharacterJoiner(e12) {
            if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
            const t8 = this._characterJoinerService.register(e12);
            return this.refresh(0, this.rows - 1), t8;
          }
          deregisterCharacterJoiner(e12) {
            if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
            this._characterJoinerService.deregister(e12) && this.refresh(0, this.rows - 1);
          }
          get markers() {
            return this.buffer.markers;
          }
          registerMarker(e12) {
            return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e12);
          }
          registerDecoration(e12) {
            return this._decorationService.registerDecoration(e12);
          }
          hasSelection() {
            return !!this._selectionService && this._selectionService.hasSelection;
          }
          select(e12, t8, i10) {
            this._selectionService.setSelection(e12, t8, i10);
          }
          getSelection() {
            return this._selectionService ? this._selectionService.selectionText : "";
          }
          getSelectionPosition() {
            if (this._selectionService && this._selectionService.hasSelection) return { start: { x: this._selectionService.selectionStart[0], y: this._selectionService.selectionStart[1] }, end: { x: this._selectionService.selectionEnd[0], y: this._selectionService.selectionEnd[1] } };
          }
          clearSelection() {
            var e12;
            null === (e12 = this._selectionService) || void 0 === e12 || e12.clearSelection();
          }
          selectAll() {
            var e12;
            null === (e12 = this._selectionService) || void 0 === e12 || e12.selectAll();
          }
          selectLines(e12, t8) {
            var i10;
            null === (i10 = this._selectionService) || void 0 === i10 || i10.selectLines(e12, t8);
          }
          _keyDown(e12) {
            if (this._keyDownHandled = false, this._keyDownSeen = true, this._customKeyEventHandler && false === this._customKeyEventHandler(e12)) return false;
            const t8 = this.browser.isMac && this.options.macOptionIsMeta && e12.altKey;
            if (!t8 && !this._compositionHelper.keydown(e12)) return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(), false;
            t8 || "Dead" !== e12.key && "AltGraph" !== e12.key || (this._unprocessedDeadKey = true);
            const i10 = (0, R2.evaluateKeyboardEvent)(e12, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
            if (this.updateCursorStyle(e12), 3 === i10.type || 2 === i10.type) {
              const t9 = this.rows - 1;
              return this.scrollLines(2 === i10.type ? -t9 : t9), this.cancel(e12, true);
            }
            return 1 === i10.type && this.selectAll(), !!this._isThirdLevelShift(this.browser, e12) || (i10.cancel && this.cancel(e12, true), !i10.key || !!(e12.key && !e12.ctrlKey && !e12.altKey && !e12.metaKey && 1 === e12.key.length && e12.key.charCodeAt(0) >= 65 && e12.key.charCodeAt(0) <= 90) || (this._unprocessedDeadKey ? (this._unprocessedDeadKey = false, true) : (i10.key !== D2.C0.ETX && i10.key !== D2.C0.CR || (this.textarea.value = ""), this._onKey.fire({ key: i10.key, domEvent: e12 }), this._showCursor(), this.coreService.triggerDataEvent(i10.key, true), !this.optionsService.rawOptions.screenReaderMode || e12.altKey || e12.ctrlKey ? this.cancel(e12, true) : void (this._keyDownHandled = true))));
          }
          _isThirdLevelShift(e12, t8) {
            const i10 = e12.isMac && !this.options.macOptionIsMeta && t8.altKey && !t8.ctrlKey && !t8.metaKey || e12.isWindows && t8.altKey && t8.ctrlKey && !t8.metaKey || e12.isWindows && t8.getModifierState("AltGraph");
            return "keypress" === t8.type ? i10 : i10 && (!t8.keyCode || t8.keyCode > 47);
          }
          _keyUp(e12) {
            this._keyDownSeen = false, this._customKeyEventHandler && false === this._customKeyEventHandler(e12) || ((function(e13) {
              return 16 === e13.keyCode || 17 === e13.keyCode || 18 === e13.keyCode;
            })(e12) || this.focus(), this.updateCursorStyle(e12), this._keyPressHandled = false);
          }
          _keyPress(e12) {
            let t8;
            if (this._keyPressHandled = false, this._keyDownHandled) return false;
            if (this._customKeyEventHandler && false === this._customKeyEventHandler(e12)) return false;
            if (this.cancel(e12), e12.charCode) t8 = e12.charCode;
            else if (null === e12.which || void 0 === e12.which) t8 = e12.keyCode;
            else {
              if (0 === e12.which || 0 === e12.charCode) return false;
              t8 = e12.which;
            }
            return !(!t8 || (e12.altKey || e12.ctrlKey || e12.metaKey) && !this._isThirdLevelShift(this.browser, e12) || (t8 = String.fromCharCode(t8), this._onKey.fire({ key: t8, domEvent: e12 }), this._showCursor(), this.coreService.triggerDataEvent(t8, true), this._keyPressHandled = true, this._unprocessedDeadKey = false, 0));
          }
          _inputEvent(e12) {
            if (e12.data && "insertText" === e12.inputType && (!e12.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
              if (this._keyPressHandled) return false;
              this._unprocessedDeadKey = false;
              const t8 = e12.data;
              return this.coreService.triggerDataEvent(t8, true), this.cancel(e12), true;
            }
            return false;
          }
          resize(e12, t8) {
            e12 !== this.cols || t8 !== this.rows ? super.resize(e12, t8) : this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
          }
          _afterResize(e12, t8) {
            var i10, s6;
            null === (i10 = this._charSizeService) || void 0 === i10 || i10.measure(), null === (s6 = this.viewport) || void 0 === s6 || s6.syncScrollArea(true);
          }
          clear() {
            var e12;
            if (0 !== this.buffer.ybase || 0 !== this.buffer.y) {
              this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
              for (let e13 = 1; e13 < this.rows; e13++) this.buffer.lines.push(this.buffer.getBlankLine(L2.DEFAULT_ATTR_DATA));
              this._onScroll.fire({ position: this.buffer.ydisp, source: 0 }), null === (e12 = this.viewport) || void 0 === e12 || e12.reset(), this.refresh(0, this.rows - 1);
            }
          }
          reset() {
            var e12, t8;
            this.options.rows = this.rows, this.options.cols = this.cols;
            const i10 = this._customKeyEventHandler;
            this._setup(), super.reset(), null === (e12 = this._selectionService) || void 0 === e12 || e12.reset(), this._decorationService.reset(), null === (t8 = this.viewport) || void 0 === t8 || t8.reset(), this._customKeyEventHandler = i10, this.refresh(0, this.rows - 1);
          }
          clearTextureAtlas() {
            var e12;
            null === (e12 = this._renderService) || void 0 === e12 || e12.clearTextureAtlas();
          }
          _reportFocus() {
            var e12;
            (null === (e12 = this.element) || void 0 === e12 ? void 0 : e12.classList.contains("focus")) ? this.coreService.triggerDataEvent(D2.C0.ESC + "[I") : this.coreService.triggerDataEvent(D2.C0.ESC + "[O");
          }
          _reportWindowsOptions(e12) {
            if (this._renderService) switch (e12) {
              case T2.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:
                const e13 = this._renderService.dimensions.css.canvas.width.toFixed(0), t8 = this._renderService.dimensions.css.canvas.height.toFixed(0);
                this.coreService.triggerDataEvent(`${D2.C0.ESC}[4;${t8};${e13}t`);
                break;
              case T2.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:
                const i10 = this._renderService.dimensions.css.cell.width.toFixed(0), s6 = this._renderService.dimensions.css.cell.height.toFixed(0);
                this.coreService.triggerDataEvent(`${D2.C0.ESC}[6;${s6};${i10}t`);
            }
          }
          cancel(e12, t8) {
            if (this.options.cancelEvents || t8) return e12.preventDefault(), e12.stopPropagation(), false;
          }
        }
        t7.Terminal = P4;
      }, 9924: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.TimeBasedDebouncer = void 0, t7.TimeBasedDebouncer = class {
          constructor(e12, t8 = 1e3) {
            this._renderCallback = e12, this._debounceThresholdMS = t8, this._lastRefreshMs = 0, this._additionalRefreshRequested = false;
          }
          dispose() {
            this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
          }
          refresh(e12, t8, i9) {
            this._rowCount = i9, e12 = void 0 !== e12 ? e12 : 0, t8 = void 0 !== t8 ? t8 : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e12) : e12, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t8) : t8;
            const s5 = Date.now();
            if (s5 - this._lastRefreshMs >= this._debounceThresholdMS) this._lastRefreshMs = s5, this._innerRefresh();
            else if (!this._additionalRefreshRequested) {
              const e13 = s5 - this._lastRefreshMs, t9 = this._debounceThresholdMS - e13;
              this._additionalRefreshRequested = true, this._refreshTimeoutID = window.setTimeout((() => {
                this._lastRefreshMs = Date.now(), this._innerRefresh(), this._additionalRefreshRequested = false, this._refreshTimeoutID = void 0;
              }), t9);
            }
          }
          _innerRefresh() {
            if (void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount) return;
            const e12 = Math.max(this._rowStart, 0), t8 = Math.min(this._rowEnd, this._rowCount - 1);
            this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e12, t8);
          }
        };
      }, 1680: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Viewport = void 0;
        const n6 = i9(3656), o10 = i9(4725), a4 = i9(8460), h4 = i9(844), c5 = i9(2585);
        let l6 = t7.Viewport = class extends h4.Disposable {
          constructor(e12, t8, i10, s6, r12, o11, h5, c6) {
            super(), this._viewportElement = e12, this._scrollArea = t8, this._bufferService = i10, this._optionsService = s6, this._charSizeService = r12, this._renderService = o11, this._coreBrowserService = h5, this.scrollBarWidth = 0, this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._wheelPartialScroll = 0, this._refreshAnimationFrame = null, this._ignoreNextScrollEvent = false, this._smoothScrollState = { startTime: 0, origin: -1, target: -1 }, this._onRequestScrollLines = this.register(new a4.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this.scrollBarWidth = this._viewportElement.offsetWidth - this._scrollArea.offsetWidth || 15, this.register((0, n6.addDisposableDomListener)(this._viewportElement, "scroll", this._handleScroll.bind(this))), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate(((e13) => this._activeBuffer = e13.activeBuffer))), this._renderDimensions = this._renderService.dimensions, this.register(this._renderService.onDimensionsChange(((e13) => this._renderDimensions = e13))), this._handleThemeChange(c6.colors), this.register(c6.onChangeColors(((e13) => this._handleThemeChange(e13)))), this.register(this._optionsService.onSpecificOptionChange("scrollback", (() => this.syncScrollArea()))), setTimeout((() => this.syncScrollArea()));
          }
          _handleThemeChange(e12) {
            this._viewportElement.style.backgroundColor = e12.background.css;
          }
          reset() {
            this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._coreBrowserService.window.requestAnimationFrame((() => this.syncScrollArea()));
          }
          _refresh(e12) {
            if (e12) return this._innerRefresh(), void (null !== this._refreshAnimationFrame && this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));
            null === this._refreshAnimationFrame && (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame((() => this._innerRefresh())));
          }
          _innerRefresh() {
            if (this._charSizeService.height > 0) {
              this._currentRowHeight = this._renderService.dimensions.device.cell.height / this._coreBrowserService.dpr, this._currentDeviceCellHeight = this._renderService.dimensions.device.cell.height, this._lastRecordedViewportHeight = this._viewportElement.offsetHeight;
              const e13 = Math.round(this._currentRowHeight * this._lastRecordedBufferLength) + (this._lastRecordedViewportHeight - this._renderService.dimensions.css.canvas.height);
              this._lastRecordedBufferHeight !== e13 && (this._lastRecordedBufferHeight = e13, this._scrollArea.style.height = this._lastRecordedBufferHeight + "px");
            }
            const e12 = this._bufferService.buffer.ydisp * this._currentRowHeight;
            this._viewportElement.scrollTop !== e12 && (this._ignoreNextScrollEvent = true, this._viewportElement.scrollTop = e12), this._refreshAnimationFrame = null;
          }
          syncScrollArea(e12 = false) {
            if (this._lastRecordedBufferLength !== this._bufferService.buffer.lines.length) return this._lastRecordedBufferLength = this._bufferService.buffer.lines.length, void this._refresh(e12);
            this._lastRecordedViewportHeight === this._renderService.dimensions.css.canvas.height && this._lastScrollTop === this._activeBuffer.ydisp * this._currentRowHeight && this._renderDimensions.device.cell.height === this._currentDeviceCellHeight || this._refresh(e12);
          }
          _handleScroll(e12) {
            if (this._lastScrollTop = this._viewportElement.scrollTop, !this._viewportElement.offsetParent) return;
            if (this._ignoreNextScrollEvent) return this._ignoreNextScrollEvent = false, void this._onRequestScrollLines.fire({ amount: 0, suppressScrollEvent: true });
            const t8 = Math.round(this._lastScrollTop / this._currentRowHeight) - this._bufferService.buffer.ydisp;
            this._onRequestScrollLines.fire({ amount: t8, suppressScrollEvent: true });
          }
          _smoothScroll() {
            if (this._isDisposed || -1 === this._smoothScrollState.origin || -1 === this._smoothScrollState.target) return;
            const e12 = this._smoothScrollPercent();
            this._viewportElement.scrollTop = this._smoothScrollState.origin + Math.round(e12 * (this._smoothScrollState.target - this._smoothScrollState.origin)), e12 < 1 ? this._coreBrowserService.window.requestAnimationFrame((() => this._smoothScroll())) : this._clearSmoothScrollState();
          }
          _smoothScrollPercent() {
            return this._optionsService.rawOptions.smoothScrollDuration && this._smoothScrollState.startTime ? Math.max(Math.min((Date.now() - this._smoothScrollState.startTime) / this._optionsService.rawOptions.smoothScrollDuration, 1), 0) : 1;
          }
          _clearSmoothScrollState() {
            this._smoothScrollState.startTime = 0, this._smoothScrollState.origin = -1, this._smoothScrollState.target = -1;
          }
          _bubbleScroll(e12, t8) {
            const i10 = this._viewportElement.scrollTop + this._lastRecordedViewportHeight;
            return !(t8 < 0 && 0 !== this._viewportElement.scrollTop || t8 > 0 && i10 < this._lastRecordedBufferHeight) || (e12.cancelable && e12.preventDefault(), false);
          }
          handleWheel(e12) {
            const t8 = this._getPixelsScrolled(e12);
            return 0 !== t8 && (this._optionsService.rawOptions.smoothScrollDuration ? (this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, -1 === this._smoothScrollState.target ? this._smoothScrollState.target = this._viewportElement.scrollTop + t8 : this._smoothScrollState.target += t8, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState()) : this._viewportElement.scrollTop += t8, this._bubbleScroll(e12, t8));
          }
          scrollLines(e12) {
            if (0 !== e12) if (this._optionsService.rawOptions.smoothScrollDuration) {
              const t8 = e12 * this._currentRowHeight;
              this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, this._smoothScrollState.target = this._smoothScrollState.origin + t8, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState();
            } else this._onRequestScrollLines.fire({ amount: e12, suppressScrollEvent: false });
          }
          _getPixelsScrolled(e12) {
            if (0 === e12.deltaY || e12.shiftKey) return 0;
            let t8 = this._applyScrollModifier(e12.deltaY, e12);
            return e12.deltaMode === WheelEvent.DOM_DELTA_LINE ? t8 *= this._currentRowHeight : e12.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t8 *= this._currentRowHeight * this._bufferService.rows), t8;
          }
          getBufferElements(e12, t8) {
            var i10;
            let s6, r12 = "";
            const n7 = [], o11 = null != t8 ? t8 : this._bufferService.buffer.lines.length, a5 = this._bufferService.buffer.lines;
            for (let t9 = e12; t9 < o11; t9++) {
              const e13 = a5.get(t9);
              if (!e13) continue;
              const o12 = null === (i10 = a5.get(t9 + 1)) || void 0 === i10 ? void 0 : i10.isWrapped;
              if (r12 += e13.translateToString(!o12), !o12 || t9 === a5.length - 1) {
                const e14 = document.createElement("div");
                e14.textContent = r12, n7.push(e14), r12.length > 0 && (s6 = e14), r12 = "";
              }
            }
            return { bufferElements: n7, cursorElement: s6 };
          }
          getLinesScrolled(e12) {
            if (0 === e12.deltaY || e12.shiftKey) return 0;
            let t8 = this._applyScrollModifier(e12.deltaY, e12);
            return e12.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (t8 /= this._currentRowHeight + 0, this._wheelPartialScroll += t8, t8 = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e12.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t8 *= this._bufferService.rows), t8;
          }
          _applyScrollModifier(e12, t8) {
            const i10 = this._optionsService.rawOptions.fastScrollModifier;
            return "alt" === i10 && t8.altKey || "ctrl" === i10 && t8.ctrlKey || "shift" === i10 && t8.shiftKey ? e12 * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e12 * this._optionsService.rawOptions.scrollSensitivity;
          }
          handleTouchStart(e12) {
            this._lastTouchY = e12.touches[0].pageY;
          }
          handleTouchMove(e12) {
            const t8 = this._lastTouchY - e12.touches[0].pageY;
            return this._lastTouchY = e12.touches[0].pageY, 0 !== t8 && (this._viewportElement.scrollTop += t8, this._bubbleScroll(e12, t8));
          }
        };
        t7.Viewport = l6 = s5([r11(2, c5.IBufferService), r11(3, c5.IOptionsService), r11(4, o10.ICharSizeService), r11(5, o10.IRenderService), r11(6, o10.ICoreBrowserService), r11(7, o10.IThemeService)], l6);
      }, 3107: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferDecorationRenderer = void 0;
        const n6 = i9(3656), o10 = i9(4725), a4 = i9(844), h4 = i9(2585);
        let c5 = t7.BufferDecorationRenderer = class extends a4.Disposable {
          constructor(e12, t8, i10, s6) {
            super(), this._screenElement = e12, this._bufferService = t8, this._decorationService = i10, this._renderService = s6, this._decorationElements = /* @__PURE__ */ new Map(), this._altBufferIsActive = false, this._dimensionsChanged = false, this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this.register(this._renderService.onRenderedViewportChange((() => this._doRefreshDecorations()))), this.register(this._renderService.onDimensionsChange((() => {
              this._dimensionsChanged = true, this._queueRefresh();
            }))), this.register((0, n6.addDisposableDomListener)(window, "resize", (() => this._queueRefresh()))), this.register(this._bufferService.buffers.onBufferActivate((() => {
              this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
            }))), this.register(this._decorationService.onDecorationRegistered((() => this._queueRefresh()))), this.register(this._decorationService.onDecorationRemoved(((e13) => this._removeDecoration(e13)))), this.register((0, a4.toDisposable)((() => {
              this._container.remove(), this._decorationElements.clear();
            })));
          }
          _queueRefresh() {
            void 0 === this._animationFrame && (this._animationFrame = this._renderService.addRefreshCallback((() => {
              this._doRefreshDecorations(), this._animationFrame = void 0;
            })));
          }
          _doRefreshDecorations() {
            for (const e12 of this._decorationService.decorations) this._renderDecoration(e12);
            this._dimensionsChanged = false;
          }
          _renderDecoration(e12) {
            this._refreshStyle(e12), this._dimensionsChanged && this._refreshXPosition(e12);
          }
          _createElement(e12) {
            var t8, i10;
            const s6 = document.createElement("div");
            s6.classList.add("xterm-decoration"), s6.classList.toggle("xterm-decoration-top-layer", "top" === (null === (t8 = null == e12 ? void 0 : e12.options) || void 0 === t8 ? void 0 : t8.layer)), s6.style.width = `${Math.round((e12.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, s6.style.height = (e12.options.height || 1) * this._renderService.dimensions.css.cell.height + "px", s6.style.top = (e12.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height + "px", s6.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
            const r12 = null !== (i10 = e12.options.x) && void 0 !== i10 ? i10 : 0;
            return r12 && r12 > this._bufferService.cols && (s6.style.display = "none"), this._refreshXPosition(e12, s6), s6;
          }
          _refreshStyle(e12) {
            const t8 = e12.marker.line - this._bufferService.buffers.active.ydisp;
            if (t8 < 0 || t8 >= this._bufferService.rows) e12.element && (e12.element.style.display = "none", e12.onRenderEmitter.fire(e12.element));
            else {
              let i10 = this._decorationElements.get(e12);
              i10 || (i10 = this._createElement(e12), e12.element = i10, this._decorationElements.set(e12, i10), this._container.appendChild(i10), e12.onDispose((() => {
                this._decorationElements.delete(e12), i10.remove();
              }))), i10.style.top = t8 * this._renderService.dimensions.css.cell.height + "px", i10.style.display = this._altBufferIsActive ? "none" : "block", e12.onRenderEmitter.fire(i10);
            }
          }
          _refreshXPosition(e12, t8 = e12.element) {
            var i10;
            if (!t8) return;
            const s6 = null !== (i10 = e12.options.x) && void 0 !== i10 ? i10 : 0;
            "right" === (e12.options.anchor || "left") ? t8.style.right = s6 ? s6 * this._renderService.dimensions.css.cell.width + "px" : "" : t8.style.left = s6 ? s6 * this._renderService.dimensions.css.cell.width + "px" : "";
          }
          _removeDecoration(e12) {
            var t8;
            null === (t8 = this._decorationElements.get(e12)) || void 0 === t8 || t8.remove(), this._decorationElements.delete(e12), e12.dispose();
          }
        };
        t7.BufferDecorationRenderer = c5 = s5([r11(1, h4.IBufferService), r11(2, h4.IDecorationService), r11(3, o10.IRenderService)], c5);
      }, 5871: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.ColorZoneStore = void 0, t7.ColorZoneStore = class {
          constructor() {
            this._zones = [], this._zonePool = [], this._zonePoolIndex = 0, this._linePadding = { full: 0, left: 0, center: 0, right: 0 };
          }
          get zones() {
            return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
          }
          clear() {
            this._zones.length = 0, this._zonePoolIndex = 0;
          }
          addDecoration(e12) {
            if (e12.options.overviewRulerOptions) {
              for (const t8 of this._zones) if (t8.color === e12.options.overviewRulerOptions.color && t8.position === e12.options.overviewRulerOptions.position) {
                if (this._lineIntersectsZone(t8, e12.marker.line)) return;
                if (this._lineAdjacentToZone(t8, e12.marker.line, e12.options.overviewRulerOptions.position)) return void this._addLineToZone(t8, e12.marker.line);
              }
              if (this._zonePoolIndex < this._zonePool.length) return this._zonePool[this._zonePoolIndex].color = e12.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = e12.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = e12.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = e12.marker.line, void this._zones.push(this._zonePool[this._zonePoolIndex++]);
              this._zones.push({ color: e12.options.overviewRulerOptions.color, position: e12.options.overviewRulerOptions.position, startBufferLine: e12.marker.line, endBufferLine: e12.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
            }
          }
          setPadding(e12) {
            this._linePadding = e12;
          }
          _lineIntersectsZone(e12, t8) {
            return t8 >= e12.startBufferLine && t8 <= e12.endBufferLine;
          }
          _lineAdjacentToZone(e12, t8, i9) {
            return t8 >= e12.startBufferLine - this._linePadding[i9 || "full"] && t8 <= e12.endBufferLine + this._linePadding[i9 || "full"];
          }
          _addLineToZone(e12, t8) {
            e12.startBufferLine = Math.min(e12.startBufferLine, t8), e12.endBufferLine = Math.max(e12.endBufferLine, t8);
          }
        };
      }, 5744: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.OverviewRulerRenderer = void 0;
        const n6 = i9(5871), o10 = i9(3656), a4 = i9(4725), h4 = i9(844), c5 = i9(2585), l6 = { full: 0, left: 0, center: 0, right: 0 }, d3 = { full: 0, left: 0, center: 0, right: 0 }, _3 = { full: 0, left: 0, center: 0, right: 0 };
        let u4 = t7.OverviewRulerRenderer = class extends h4.Disposable {
          get _width() {
            return this._optionsService.options.overviewRulerWidth || 0;
          }
          constructor(e12, t8, i10, s6, r12, o11, a5) {
            var c6;
            super(), this._viewportElement = e12, this._screenElement = t8, this._bufferService = i10, this._decorationService = s6, this._renderService = r12, this._optionsService = o11, this._coreBrowseService = a5, this._colorZoneStore = new n6.ColorZoneStore(), this._shouldUpdateDimensions = true, this._shouldUpdateAnchor = true, this._lastKnownBufferLength = 0, this._canvas = document.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), null === (c6 = this._viewportElement.parentElement) || void 0 === c6 || c6.insertBefore(this._canvas, this._viewportElement);
            const l7 = this._canvas.getContext("2d");
            if (!l7) throw new Error("Ctx cannot be null");
            this._ctx = l7, this._registerDecorationListeners(), this._registerBufferChangeListeners(), this._registerDimensionChangeListeners(), this.register((0, h4.toDisposable)((() => {
              var e13;
              null === (e13 = this._canvas) || void 0 === e13 || e13.remove();
            })));
          }
          _registerDecorationListeners() {
            this.register(this._decorationService.onDecorationRegistered((() => this._queueRefresh(void 0, true)))), this.register(this._decorationService.onDecorationRemoved((() => this._queueRefresh(void 0, true))));
          }
          _registerBufferChangeListeners() {
            this.register(this._renderService.onRenderedViewportChange((() => this._queueRefresh()))), this.register(this._bufferService.buffers.onBufferActivate((() => {
              this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
            }))), this.register(this._bufferService.onScroll((() => {
              this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
            })));
          }
          _registerDimensionChangeListeners() {
            this.register(this._renderService.onRender((() => {
              this._containerHeight && this._containerHeight === this._screenElement.clientHeight || (this._queueRefresh(true), this._containerHeight = this._screenElement.clientHeight);
            }))), this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth", (() => this._queueRefresh(true)))), this.register((0, o10.addDisposableDomListener)(this._coreBrowseService.window, "resize", (() => this._queueRefresh(true)))), this._queueRefresh(true);
          }
          _refreshDrawConstants() {
            const e12 = Math.floor(this._canvas.width / 3), t8 = Math.ceil(this._canvas.width / 3);
            d3.full = this._canvas.width, d3.left = e12, d3.center = t8, d3.right = e12, this._refreshDrawHeightConstants(), _3.full = 0, _3.left = 0, _3.center = d3.left, _3.right = d3.left + d3.center;
          }
          _refreshDrawHeightConstants() {
            l6.full = Math.round(2 * this._coreBrowseService.dpr);
            const e12 = this._canvas.height / this._bufferService.buffer.lines.length, t8 = Math.round(Math.max(Math.min(e12, 12), 6) * this._coreBrowseService.dpr);
            l6.left = t8, l6.center = t8, l6.right = t8;
          }
          _refreshColorZonePadding() {
            this._colorZoneStore.setPadding({ full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l6.full), left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l6.left), center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l6.center), right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * l6.right) }), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
          }
          _refreshCanvasDimensions() {
            this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowseService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowseService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
          }
          _refreshDecorations() {
            this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
            for (const e13 of this._decorationService.decorations) this._colorZoneStore.addDecoration(e13);
            this._ctx.lineWidth = 1;
            const e12 = this._colorZoneStore.zones;
            for (const t8 of e12) "full" !== t8.position && this._renderColorZone(t8);
            for (const t8 of e12) "full" === t8.position && this._renderColorZone(t8);
            this._shouldUpdateDimensions = false, this._shouldUpdateAnchor = false;
          }
          _renderColorZone(e12) {
            this._ctx.fillStyle = e12.color, this._ctx.fillRect(_3[e12.position || "full"], Math.round((this._canvas.height - 1) * (e12.startBufferLine / this._bufferService.buffers.active.lines.length) - l6[e12.position || "full"] / 2), d3[e12.position || "full"], Math.round((this._canvas.height - 1) * ((e12.endBufferLine - e12.startBufferLine) / this._bufferService.buffers.active.lines.length) + l6[e12.position || "full"]));
          }
          _queueRefresh(e12, t8) {
            this._shouldUpdateDimensions = e12 || this._shouldUpdateDimensions, this._shouldUpdateAnchor = t8 || this._shouldUpdateAnchor, void 0 === this._animationFrame && (this._animationFrame = this._coreBrowseService.window.requestAnimationFrame((() => {
              this._refreshDecorations(), this._animationFrame = void 0;
            })));
          }
        };
        t7.OverviewRulerRenderer = u4 = s5([r11(2, c5.IBufferService), r11(3, c5.IDecorationService), r11(4, a4.IRenderService), r11(5, c5.IOptionsService), r11(6, a4.ICoreBrowserService)], u4);
      }, 2950: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CompositionHelper = void 0;
        const n6 = i9(4725), o10 = i9(2585), a4 = i9(2584);
        let h4 = t7.CompositionHelper = class {
          get isComposing() {
            return this._isComposing;
          }
          constructor(e12, t8, i10, s6, r12, n7) {
            this._textarea = e12, this._compositionView = t8, this._bufferService = i10, this._optionsService = s6, this._coreService = r12, this._renderService = n7, this._isComposing = false, this._isSendingComposition = false, this._compositionPosition = { start: 0, end: 0 }, this._dataAlreadySent = "";
          }
          compositionstart() {
            this._isComposing = true, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
          }
          compositionupdate(e12) {
            this._compositionView.textContent = e12.data, this.updateCompositionElements(), setTimeout((() => {
              this._compositionPosition.end = this._textarea.value.length;
            }), 0);
          }
          compositionend() {
            this._finalizeComposition(true);
          }
          keydown(e12) {
            if (this._isComposing || this._isSendingComposition) {
              if (229 === e12.keyCode) return false;
              if (16 === e12.keyCode || 17 === e12.keyCode || 18 === e12.keyCode) return false;
              this._finalizeComposition(false);
            }
            return 229 !== e12.keyCode || (this._handleAnyTextareaChanges(), false);
          }
          _finalizeComposition(e12) {
            if (this._compositionView.classList.remove("active"), this._isComposing = false, e12) {
              const e13 = { start: this._compositionPosition.start, end: this._compositionPosition.end };
              this._isSendingComposition = true, setTimeout((() => {
                if (this._isSendingComposition) {
                  let t8;
                  this._isSendingComposition = false, e13.start += this._dataAlreadySent.length, t8 = this._isComposing ? this._textarea.value.substring(e13.start, e13.end) : this._textarea.value.substring(e13.start), t8.length > 0 && this._coreService.triggerDataEvent(t8, true);
                }
              }), 0);
            } else {
              this._isSendingComposition = false;
              const e13 = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
              this._coreService.triggerDataEvent(e13, true);
            }
          }
          _handleAnyTextareaChanges() {
            const e12 = this._textarea.value;
            setTimeout((() => {
              if (!this._isComposing) {
                const t8 = this._textarea.value, i10 = t8.replace(e12, "");
                this._dataAlreadySent = i10, t8.length > e12.length ? this._coreService.triggerDataEvent(i10, true) : t8.length < e12.length ? this._coreService.triggerDataEvent(`${a4.C0.DEL}`, true) : t8.length === e12.length && t8 !== e12 && this._coreService.triggerDataEvent(t8, true);
              }
            }), 0);
          }
          updateCompositionElements(e12) {
            if (this._isComposing) {
              if (this._bufferService.buffer.isCursorInViewport) {
                const e13 = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), t8 = this._renderService.dimensions.css.cell.height, i10 = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, s6 = e13 * this._renderService.dimensions.css.cell.width;
                this._compositionView.style.left = s6 + "px", this._compositionView.style.top = i10 + "px", this._compositionView.style.height = t8 + "px", this._compositionView.style.lineHeight = t8 + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
                const r12 = this._compositionView.getBoundingClientRect();
                this._textarea.style.left = s6 + "px", this._textarea.style.top = i10 + "px", this._textarea.style.width = Math.max(r12.width, 1) + "px", this._textarea.style.height = Math.max(r12.height, 1) + "px", this._textarea.style.lineHeight = r12.height + "px";
              }
              e12 || setTimeout((() => this.updateCompositionElements(true)), 0);
            }
          }
        };
        t7.CompositionHelper = h4 = s5([r11(2, o10.IBufferService), r11(3, o10.IOptionsService), r11(4, o10.ICoreService), r11(5, n6.IRenderService)], h4);
      }, 9806: (e11, t7) => {
        function i9(e12, t8, i10) {
          const s5 = i10.getBoundingClientRect(), r11 = e12.getComputedStyle(i10), n6 = parseInt(r11.getPropertyValue("padding-left")), o10 = parseInt(r11.getPropertyValue("padding-top"));
          return [t8.clientX - s5.left - n6, t8.clientY - s5.top - o10];
        }
        Object.defineProperty(t7, "__esModule", { value: true }), t7.getCoords = t7.getCoordsRelativeToElement = void 0, t7.getCoordsRelativeToElement = i9, t7.getCoords = function(e12, t8, s5, r11, n6, o10, a4, h4, c5) {
          if (!o10) return;
          const l6 = i9(e12, t8, s5);
          return l6 ? (l6[0] = Math.ceil((l6[0] + (c5 ? a4 / 2 : 0)) / a4), l6[1] = Math.ceil(l6[1] / h4), l6[0] = Math.min(Math.max(l6[0], 1), r11 + (c5 ? 1 : 0)), l6[1] = Math.min(Math.max(l6[1], 1), n6), l6) : void 0;
        };
      }, 9504: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.moveToCellSequence = void 0;
        const s5 = i9(2584);
        function r11(e12, t8, i10, s6) {
          const r12 = e12 - n6(e12, i10), a5 = t8 - n6(t8, i10), l6 = Math.abs(r12 - a5) - (function(e13, t9, i11) {
            let s7 = 0;
            const r13 = e13 - n6(e13, i11), a6 = t9 - n6(t9, i11);
            for (let n7 = 0; n7 < Math.abs(r13 - a6); n7++) {
              const a7 = "A" === o10(e13, t9) ? -1 : 1, h5 = i11.buffer.lines.get(r13 + a7 * n7);
              (null == h5 ? void 0 : h5.isWrapped) && s7++;
            }
            return s7;
          })(e12, t8, i10);
          return c5(l6, h4(o10(e12, t8), s6));
        }
        function n6(e12, t8) {
          let i10 = 0, s6 = t8.buffer.lines.get(e12), r12 = null == s6 ? void 0 : s6.isWrapped;
          for (; r12 && e12 >= 0 && e12 < t8.rows; ) i10++, s6 = t8.buffer.lines.get(--e12), r12 = null == s6 ? void 0 : s6.isWrapped;
          return i10;
        }
        function o10(e12, t8) {
          return e12 > t8 ? "A" : "B";
        }
        function a4(e12, t8, i10, s6, r12, n7) {
          let o11 = e12, a5 = t8, h5 = "";
          for (; o11 !== i10 || a5 !== s6; ) o11 += r12 ? 1 : -1, r12 && o11 > n7.cols - 1 ? (h5 += n7.buffer.translateBufferLineToString(a5, false, e12, o11), o11 = 0, e12 = 0, a5++) : !r12 && o11 < 0 && (h5 += n7.buffer.translateBufferLineToString(a5, false, 0, e12 + 1), o11 = n7.cols - 1, e12 = o11, a5--);
          return h5 + n7.buffer.translateBufferLineToString(a5, false, e12, o11);
        }
        function h4(e12, t8) {
          const i10 = t8 ? "O" : "[";
          return s5.C0.ESC + i10 + e12;
        }
        function c5(e12, t8) {
          e12 = Math.floor(e12);
          let i10 = "";
          for (let s6 = 0; s6 < e12; s6++) i10 += t8;
          return i10;
        }
        t7.moveToCellSequence = function(e12, t8, i10, s6) {
          const o11 = i10.buffer.x, l6 = i10.buffer.y;
          if (!i10.buffer.hasScrollback) return (function(e13, t9, i11, s7, o12, l7) {
            return 0 === r11(t9, s7, o12, l7).length ? "" : c5(a4(e13, t9, e13, t9 - n6(t9, o12), false, o12).length, h4("D", l7));
          })(o11, l6, 0, t8, i10, s6) + r11(l6, t8, i10, s6) + (function(e13, t9, i11, s7, o12, l7) {
            let d4;
            d4 = r11(t9, s7, o12, l7).length > 0 ? s7 - n6(s7, o12) : t9;
            const _4 = s7, u4 = (function(e14, t10, i12, s8, o13, a5) {
              let h5;
              return h5 = r11(i12, s8, o13, a5).length > 0 ? s8 - n6(s8, o13) : t10, e14 < i12 && h5 <= s8 || e14 >= i12 && h5 < s8 ? "C" : "D";
            })(e13, t9, i11, s7, o12, l7);
            return c5(a4(e13, d4, i11, _4, "C" === u4, o12).length, h4(u4, l7));
          })(o11, l6, e12, t8, i10, s6);
          let d3;
          if (l6 === t8) return d3 = o11 > e12 ? "D" : "C", c5(Math.abs(o11 - e12), h4(d3, s6));
          d3 = l6 > t8 ? "D" : "C";
          const _3 = Math.abs(l6 - t8);
          return c5((function(e13, t9) {
            return t9.cols - e13;
          })(l6 > t8 ? e12 : o11, i10) + (_3 - 1) * i10.cols + 1 + ((l6 > t8 ? o11 : e12) - 1), h4(d3, s6));
        };
      }, 1296: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.DomRenderer = void 0;
        const n6 = i9(3787), o10 = i9(2550), a4 = i9(2223), h4 = i9(6171), c5 = i9(4725), l6 = i9(8055), d3 = i9(8460), _3 = i9(844), u4 = i9(2585), f3 = "xterm-dom-renderer-owner-", v2 = "xterm-rows", p4 = "xterm-fg-", g2 = "xterm-bg-", m3 = "xterm-focus", S3 = "xterm-selection";
        let C3 = 1, b3 = t7.DomRenderer = class extends _3.Disposable {
          constructor(e12, t8, i10, s6, r12, a5, c6, l7, u5, p5) {
            super(), this._element = e12, this._screenElement = t8, this._viewportElement = i10, this._linkifier2 = s6, this._charSizeService = a5, this._optionsService = c6, this._bufferService = l7, this._coreBrowserService = u5, this._themeService = p5, this._terminalClass = C3++, this._rowElements = [], this.onRequestRedraw = this.register(new d3.EventEmitter()).event, this._rowContainer = document.createElement("div"), this._rowContainer.classList.add(v2), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = document.createElement("div"), this._selectionContainer.classList.add(S3), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = (0, h4.createRenderDimensions)(), this._updateDimensions(), this.register(this._optionsService.onOptionChange((() => this._handleOptionsChanged()))), this.register(this._themeService.onChangeColors(((e13) => this._injectCss(e13)))), this._injectCss(this._themeService.colors), this._rowFactory = r12.createInstance(n6.DomRendererRowFactory, document), this._element.classList.add(f3 + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this.register(this._linkifier2.onShowLinkUnderline(((e13) => this._handleLinkHover(e13)))), this.register(this._linkifier2.onHideLinkUnderline(((e13) => this._handleLinkLeave(e13)))), this.register((0, _3.toDisposable)((() => {
              this._element.classList.remove(f3 + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
            }))), this._widthCache = new o10.WidthCache(document), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
          }
          _updateDimensions() {
            const e12 = this._coreBrowserService.dpr;
            this.dimensions.device.char.width = this._charSizeService.width * e12, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e12), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e12), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e12), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
            for (const e13 of this._rowElements) e13.style.width = `${this.dimensions.css.canvas.width}px`, e13.style.height = `${this.dimensions.css.cell.height}px`, e13.style.lineHeight = `${this.dimensions.css.cell.height}px`, e13.style.overflow = "hidden";
            this._dimensionsStyleElement || (this._dimensionsStyleElement = document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
            const t8 = `${this._terminalSelector} .${v2} span { display: inline-block; height: 100%; vertical-align: top;}`;
            this._dimensionsStyleElement.textContent = t8, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
          }
          _injectCss(e12) {
            this._themeStyleElement || (this._themeStyleElement = document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
            let t8 = `${this._terminalSelector} .${v2} { color: ${e12.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
            t8 += `${this._terminalSelector} .${v2} .xterm-dim { color: ${l6.color.multiplyOpacity(e12.foreground, 0.5).css};}`, t8 += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`, t8 += "@keyframes blink_box_shadow_" + this._terminalClass + " { 50% {  border-bottom-style: hidden; }}", t8 += "@keyframes blink_block_" + this._terminalClass + ` { 0% {  background-color: ${e12.cursor.css};  color: ${e12.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e12.cursor.css}; }}`, t8 += `${this._terminalSelector} .${v2}.${m3} .xterm-cursor.xterm-cursor-blink:not(.xterm-cursor-block) { animation: blink_box_shadow_` + this._terminalClass + ` 1s step-end infinite;}${this._terminalSelector} .${v2}.${m3} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: blink_block_` + this._terminalClass + ` 1s step-end infinite;}${this._terminalSelector} .${v2} .xterm-cursor.xterm-cursor-block { background-color: ${e12.cursor.css}; color: ${e12.cursorAccent.css};}${this._terminalSelector} .${v2} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e12.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${v2} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e12.cursor.css} inset;}${this._terminalSelector} .${v2} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e12.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, t8 += `${this._terminalSelector} .${S3} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${S3} div { position: absolute; background-color: ${e12.selectionBackgroundOpaque.css};}${this._terminalSelector} .${S3} div { position: absolute; background-color: ${e12.selectionInactiveBackgroundOpaque.css};}`;
            for (const [i10, s6] of e12.ansi.entries()) t8 += `${this._terminalSelector} .${p4}${i10} { color: ${s6.css}; }${this._terminalSelector} .${p4}${i10}.xterm-dim { color: ${l6.color.multiplyOpacity(s6, 0.5).css}; }${this._terminalSelector} .${g2}${i10} { background-color: ${s6.css}; }`;
            t8 += `${this._terminalSelector} .${p4}${a4.INVERTED_DEFAULT_COLOR} { color: ${l6.color.opaque(e12.background).css}; }${this._terminalSelector} .${p4}${a4.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${l6.color.multiplyOpacity(l6.color.opaque(e12.background), 0.5).css}; }${this._terminalSelector} .${g2}${a4.INVERTED_DEFAULT_COLOR} { background-color: ${e12.foreground.css}; }`, this._themeStyleElement.textContent = t8;
          }
          _setDefaultSpacing() {
            const e12 = this.dimensions.css.cell.width - this._widthCache.get("W", false, false);
            this._rowContainer.style.letterSpacing = `${e12}px`, this._rowFactory.defaultSpacing = e12;
          }
          handleDevicePixelRatioChange() {
            this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
          }
          _refreshRowElements(e12, t8) {
            for (let e13 = this._rowElements.length; e13 <= t8; e13++) {
              const e14 = document.createElement("div");
              this._rowContainer.appendChild(e14), this._rowElements.push(e14);
            }
            for (; this._rowElements.length > t8; ) this._rowContainer.removeChild(this._rowElements.pop());
          }
          handleResize(e12, t8) {
            this._refreshRowElements(e12, t8), this._updateDimensions();
          }
          handleCharSizeChanged() {
            this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
          }
          handleBlur() {
            this._rowContainer.classList.remove(m3);
          }
          handleFocus() {
            this._rowContainer.classList.add(m3), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
          }
          handleSelectionChanged(e12, t8, i10) {
            if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e12, t8, i10), this.renderRows(0, this._bufferService.rows - 1), !e12 || !t8) return;
            const s6 = e12[1] - this._bufferService.buffer.ydisp, r12 = t8[1] - this._bufferService.buffer.ydisp, n7 = Math.max(s6, 0), o11 = Math.min(r12, this._bufferService.rows - 1);
            if (n7 >= this._bufferService.rows || o11 < 0) return;
            const a5 = document.createDocumentFragment();
            if (i10) {
              const i11 = e12[0] > t8[0];
              a5.appendChild(this._createSelectionElement(n7, i11 ? t8[0] : e12[0], i11 ? e12[0] : t8[0], o11 - n7 + 1));
            } else {
              const i11 = s6 === n7 ? e12[0] : 0, h5 = n7 === r12 ? t8[0] : this._bufferService.cols;
              a5.appendChild(this._createSelectionElement(n7, i11, h5));
              const c6 = o11 - n7 - 1;
              if (a5.appendChild(this._createSelectionElement(n7 + 1, 0, this._bufferService.cols, c6)), n7 !== o11) {
                const e13 = r12 === o11 ? t8[0] : this._bufferService.cols;
                a5.appendChild(this._createSelectionElement(o11, 0, e13));
              }
            }
            this._selectionContainer.appendChild(a5);
          }
          _createSelectionElement(e12, t8, i10, s6 = 1) {
            const r12 = document.createElement("div");
            return r12.style.height = s6 * this.dimensions.css.cell.height + "px", r12.style.top = e12 * this.dimensions.css.cell.height + "px", r12.style.left = t8 * this.dimensions.css.cell.width + "px", r12.style.width = this.dimensions.css.cell.width * (i10 - t8) + "px", r12;
          }
          handleCursorMove() {
          }
          _handleOptionsChanged() {
            this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
          }
          clear() {
            for (const e12 of this._rowElements) e12.replaceChildren();
          }
          renderRows(e12, t8) {
            const i10 = this._bufferService.buffer, s6 = i10.ybase + i10.y, r12 = Math.min(i10.x, this._bufferService.cols - 1), n7 = this._optionsService.rawOptions.cursorBlink, o11 = this._optionsService.rawOptions.cursorStyle, a5 = this._optionsService.rawOptions.cursorInactiveStyle;
            for (let h5 = e12; h5 <= t8; h5++) {
              const e13 = h5 + i10.ydisp, t9 = this._rowElements[h5], c6 = i10.lines.get(e13);
              if (!t9 || !c6) break;
              t9.replaceChildren(...this._rowFactory.createRow(c6, e13, e13 === s6, o11, a5, r12, n7, this.dimensions.css.cell.width, this._widthCache, -1, -1));
            }
          }
          get _terminalSelector() {
            return `.${f3}${this._terminalClass}`;
          }
          _handleLinkHover(e12) {
            this._setCellUnderline(e12.x1, e12.x2, e12.y1, e12.y2, e12.cols, true);
          }
          _handleLinkLeave(e12) {
            this._setCellUnderline(e12.x1, e12.x2, e12.y1, e12.y2, e12.cols, false);
          }
          _setCellUnderline(e12, t8, i10, s6, r12, n7) {
            i10 < 0 && (e12 = 0), s6 < 0 && (t8 = 0);
            const o11 = this._bufferService.rows - 1;
            i10 = Math.max(Math.min(i10, o11), 0), s6 = Math.max(Math.min(s6, o11), 0), r12 = Math.min(r12, this._bufferService.cols);
            const a5 = this._bufferService.buffer, h5 = a5.ybase + a5.y, c6 = Math.min(a5.x, r12 - 1), l7 = this._optionsService.rawOptions.cursorBlink, d4 = this._optionsService.rawOptions.cursorStyle, _4 = this._optionsService.rawOptions.cursorInactiveStyle;
            for (let o12 = i10; o12 <= s6; ++o12) {
              const u5 = o12 + a5.ydisp, f4 = this._rowElements[o12], v3 = a5.lines.get(u5);
              if (!f4 || !v3) break;
              f4.replaceChildren(...this._rowFactory.createRow(v3, u5, u5 === h5, d4, _4, c6, l7, this.dimensions.css.cell.width, this._widthCache, n7 ? o12 === i10 ? e12 : 0 : -1, n7 ? (o12 === s6 ? t8 : r12) - 1 : -1));
            }
          }
        };
        t7.DomRenderer = b3 = s5([r11(4, u4.IInstantiationService), r11(5, c5.ICharSizeService), r11(6, u4.IOptionsService), r11(7, u4.IBufferService), r11(8, c5.ICoreBrowserService), r11(9, c5.IThemeService)], b3);
      }, 3787: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.DomRendererRowFactory = void 0;
        const n6 = i9(2223), o10 = i9(643), a4 = i9(511), h4 = i9(2585), c5 = i9(8055), l6 = i9(4725), d3 = i9(4269), _3 = i9(6171), u4 = i9(3734);
        let f3 = t7.DomRendererRowFactory = class {
          constructor(e12, t8, i10, s6, r12, n7, o11) {
            this._document = e12, this._characterJoinerService = t8, this._optionsService = i10, this._coreBrowserService = s6, this._coreService = r12, this._decorationService = n7, this._themeService = o11, this._workCell = new a4.CellData(), this._columnSelectMode = false, this.defaultSpacing = 0;
          }
          handleSelectionChanged(e12, t8, i10) {
            this._selectionStart = e12, this._selectionEnd = t8, this._columnSelectMode = i10;
          }
          createRow(e12, t8, i10, s6, r12, a5, h5, l7, _4, f4, p4) {
            const g2 = [], m3 = this._characterJoinerService.getJoinedCharacters(t8), S3 = this._themeService.colors;
            let C3, b3 = e12.getNoBgTrimmedLength();
            i10 && b3 < a5 + 1 && (b3 = a5 + 1);
            let y3 = 0, w2 = "", E2 = 0, k3 = 0, L2 = 0, D2 = false, R2 = 0, x2 = false, A3 = 0;
            const B4 = [], T2 = -1 !== f4 && -1 !== p4;
            for (let M3 = 0; M3 < b3; M3++) {
              e12.loadCell(M3, this._workCell);
              let b4 = this._workCell.getWidth();
              if (0 === b4) continue;
              let O2 = false, P4 = M3, I2 = this._workCell;
              if (m3.length > 0 && M3 === m3[0][0]) {
                O2 = true;
                const t9 = m3.shift();
                I2 = new d3.JoinedCellData(this._workCell, e12.translateToString(true, t9[0], t9[1]), t9[1] - t9[0]), P4 = t9[1] - 1, b4 = I2.getWidth();
              }
              const H3 = this._isCellInSelection(M3, t8), F2 = i10 && M3 === a5, W2 = T2 && M3 >= f4 && M3 <= p4;
              let U = false;
              this._decorationService.forEachDecorationAtCell(M3, t8, void 0, ((e13) => {
                U = true;
              }));
              let N3 = I2.getChars() || o10.WHITESPACE_CELL_CHAR;
              if (" " === N3 && (I2.isUnderline() || I2.isOverline()) && (N3 = "\xA0"), A3 = b4 * l7 - _4.get(N3, I2.isBold(), I2.isItalic()), C3) {
                if (y3 && (H3 && x2 || !H3 && !x2 && I2.bg === E2) && (H3 && x2 && S3.selectionForeground || I2.fg === k3) && I2.extended.ext === L2 && W2 === D2 && A3 === R2 && !F2 && !O2 && !U) {
                  w2 += N3, y3++;
                  continue;
                }
                y3 && (C3.textContent = w2), C3 = this._document.createElement("span"), y3 = 0, w2 = "";
              } else C3 = this._document.createElement("span");
              if (E2 = I2.bg, k3 = I2.fg, L2 = I2.extended.ext, D2 = W2, R2 = A3, x2 = H3, O2 && a5 >= M3 && a5 <= P4 && (a5 = M3), !this._coreService.isCursorHidden && F2) {
                if (B4.push("xterm-cursor"), this._coreBrowserService.isFocused) h5 && B4.push("xterm-cursor-blink"), B4.push("bar" === s6 ? "xterm-cursor-bar" : "underline" === s6 ? "xterm-cursor-underline" : "xterm-cursor-block");
                else if (r12) switch (r12) {
                  case "outline":
                    B4.push("xterm-cursor-outline");
                    break;
                  case "block":
                    B4.push("xterm-cursor-block");
                    break;
                  case "bar":
                    B4.push("xterm-cursor-bar");
                    break;
                  case "underline":
                    B4.push("xterm-cursor-underline");
                }
              }
              if (I2.isBold() && B4.push("xterm-bold"), I2.isItalic() && B4.push("xterm-italic"), I2.isDim() && B4.push("xterm-dim"), w2 = I2.isInvisible() ? o10.WHITESPACE_CELL_CHAR : I2.getChars() || o10.WHITESPACE_CELL_CHAR, I2.isUnderline() && (B4.push(`xterm-underline-${I2.extended.underlineStyle}`), " " === w2 && (w2 = "\xA0"), !I2.isUnderlineColorDefault())) if (I2.isUnderlineColorRGB()) C3.style.textDecorationColor = `rgb(${u4.AttributeData.toColorRGB(I2.getUnderlineColor()).join(",")})`;
              else {
                let e13 = I2.getUnderlineColor();
                this._optionsService.rawOptions.drawBoldTextInBrightColors && I2.isBold() && e13 < 8 && (e13 += 8), C3.style.textDecorationColor = S3.ansi[e13].css;
              }
              I2.isOverline() && (B4.push("xterm-overline"), " " === w2 && (w2 = "\xA0")), I2.isStrikethrough() && B4.push("xterm-strikethrough"), W2 && (C3.style.textDecoration = "underline");
              let $5 = I2.getFgColor(), j3 = I2.getFgColorMode(), z2 = I2.getBgColor(), K2 = I2.getBgColorMode();
              const q = !!I2.isInverse();
              if (q) {
                const e13 = $5;
                $5 = z2, z2 = e13;
                const t9 = j3;
                j3 = K2, K2 = t9;
              }
              let V4, G2, X, J = false;
              switch (this._decorationService.forEachDecorationAtCell(M3, t8, void 0, ((e13) => {
                "top" !== e13.options.layer && J || (e13.backgroundColorRGB && (K2 = 50331648, z2 = e13.backgroundColorRGB.rgba >> 8 & 16777215, V4 = e13.backgroundColorRGB), e13.foregroundColorRGB && (j3 = 50331648, $5 = e13.foregroundColorRGB.rgba >> 8 & 16777215, G2 = e13.foregroundColorRGB), J = "top" === e13.options.layer);
              })), !J && H3 && (V4 = this._coreBrowserService.isFocused ? S3.selectionBackgroundOpaque : S3.selectionInactiveBackgroundOpaque, z2 = V4.rgba >> 8 & 16777215, K2 = 50331648, J = true, S3.selectionForeground && (j3 = 50331648, $5 = S3.selectionForeground.rgba >> 8 & 16777215, G2 = S3.selectionForeground)), J && B4.push("xterm-decoration-top"), K2) {
                case 16777216:
                case 33554432:
                  X = S3.ansi[z2], B4.push(`xterm-bg-${z2}`);
                  break;
                case 50331648:
                  X = c5.rgba.toColor(z2 >> 16, z2 >> 8 & 255, 255 & z2), this._addStyle(C3, `background-color:#${v2((z2 >>> 0).toString(16), "0", 6)}`);
                  break;
                default:
                  q ? (X = S3.foreground, B4.push(`xterm-bg-${n6.INVERTED_DEFAULT_COLOR}`)) : X = S3.background;
              }
              switch (V4 || I2.isDim() && (V4 = c5.color.multiplyOpacity(X, 0.5)), j3) {
                case 16777216:
                case 33554432:
                  I2.isBold() && $5 < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && ($5 += 8), this._applyMinimumContrast(C3, X, S3.ansi[$5], I2, V4, void 0) || B4.push(`xterm-fg-${$5}`);
                  break;
                case 50331648:
                  const e13 = c5.rgba.toColor($5 >> 16 & 255, $5 >> 8 & 255, 255 & $5);
                  this._applyMinimumContrast(C3, X, e13, I2, V4, G2) || this._addStyle(C3, `color:#${v2($5.toString(16), "0", 6)}`);
                  break;
                default:
                  this._applyMinimumContrast(C3, X, S3.foreground, I2, V4, void 0) || q && B4.push(`xterm-fg-${n6.INVERTED_DEFAULT_COLOR}`);
              }
              B4.length && (C3.className = B4.join(" "), B4.length = 0), F2 || O2 || U ? C3.textContent = w2 : y3++, A3 !== this.defaultSpacing && (C3.style.letterSpacing = `${A3}px`), g2.push(C3), M3 = P4;
            }
            return C3 && y3 && (C3.textContent = w2), g2;
          }
          _applyMinimumContrast(e12, t8, i10, s6, r12, n7) {
            if (1 === this._optionsService.rawOptions.minimumContrastRatio || (0, _3.excludeFromContrastRatioDemands)(s6.getCode())) return false;
            const o11 = this._getContrastCache(s6);
            let a5;
            if (r12 || n7 || (a5 = o11.getColor(t8.rgba, i10.rgba)), void 0 === a5) {
              const e13 = this._optionsService.rawOptions.minimumContrastRatio / (s6.isDim() ? 2 : 1);
              a5 = c5.color.ensureContrastRatio(r12 || t8, n7 || i10, e13), o11.setColor((r12 || t8).rgba, (n7 || i10).rgba, null != a5 ? a5 : null);
            }
            return !!a5 && (this._addStyle(e12, `color:${a5.css}`), true);
          }
          _getContrastCache(e12) {
            return e12.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
          }
          _addStyle(e12, t8) {
            e12.setAttribute("style", `${e12.getAttribute("style") || ""}${t8};`);
          }
          _isCellInSelection(e12, t8) {
            const i10 = this._selectionStart, s6 = this._selectionEnd;
            return !(!i10 || !s6) && (this._columnSelectMode ? i10[0] <= s6[0] ? e12 >= i10[0] && t8 >= i10[1] && e12 < s6[0] && t8 <= s6[1] : e12 < i10[0] && t8 >= i10[1] && e12 >= s6[0] && t8 <= s6[1] : t8 > i10[1] && t8 < s6[1] || i10[1] === s6[1] && t8 === i10[1] && e12 >= i10[0] && e12 < s6[0] || i10[1] < s6[1] && t8 === s6[1] && e12 < s6[0] || i10[1] < s6[1] && t8 === i10[1] && e12 >= i10[0]);
          }
        };
        function v2(e12, t8, i10) {
          for (; e12.length < i10; ) e12 = t8 + e12;
          return e12;
        }
        t7.DomRendererRowFactory = f3 = s5([r11(1, l6.ICharacterJoinerService), r11(2, h4.IOptionsService), r11(3, l6.ICoreBrowserService), r11(4, h4.ICoreService), r11(5, h4.IDecorationService), r11(6, l6.IThemeService)], f3);
      }, 2550: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.WidthCache = void 0, t7.WidthCache = class {
          constructor(e12) {
            this._flat = new Float32Array(256), this._font = "", this._fontSize = 0, this._weight = "normal", this._weightBold = "bold", this._measureElements = [], this._container = e12.createElement("div"), this._container.style.position = "absolute", this._container.style.top = "-50000px", this._container.style.width = "50000px", this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
            const t8 = e12.createElement("span"), i9 = e12.createElement("span");
            i9.style.fontWeight = "bold";
            const s5 = e12.createElement("span");
            s5.style.fontStyle = "italic";
            const r11 = e12.createElement("span");
            r11.style.fontWeight = "bold", r11.style.fontStyle = "italic", this._measureElements = [t8, i9, s5, r11], this._container.appendChild(t8), this._container.appendChild(i9), this._container.appendChild(s5), this._container.appendChild(r11), e12.body.appendChild(this._container), this.clear();
          }
          dispose() {
            this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
          }
          clear() {
            this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
          }
          setFont(e12, t8, i9, s5) {
            e12 === this._font && t8 === this._fontSize && i9 === this._weight && s5 === this._weightBold || (this._font = e12, this._fontSize = t8, this._weight = i9, this._weightBold = s5, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i9}`, this._measureElements[1].style.fontWeight = `${s5}`, this._measureElements[2].style.fontWeight = `${i9}`, this._measureElements[3].style.fontWeight = `${s5}`, this.clear());
          }
          get(e12, t8, i9) {
            let s5 = 0;
            if (!t8 && !i9 && 1 === e12.length && (s5 = e12.charCodeAt(0)) < 256) return -9999 !== this._flat[s5] ? this._flat[s5] : this._flat[s5] = this._measure(e12, 0);
            let r11 = e12;
            t8 && (r11 += "B"), i9 && (r11 += "I");
            let n6 = this._holey.get(r11);
            if (void 0 === n6) {
              let s6 = 0;
              t8 && (s6 |= 1), i9 && (s6 |= 2), n6 = this._measure(e12, s6), this._holey.set(r11, n6);
            }
            return n6;
          }
          _measure(e12, t8) {
            const i9 = this._measureElements[t8];
            return i9.textContent = e12.repeat(32), i9.offsetWidth / 32;
          }
        };
      }, 2223: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.TEXT_BASELINE = t7.DIM_OPACITY = t7.INVERTED_DEFAULT_COLOR = void 0;
        const s5 = i9(6114);
        t7.INVERTED_DEFAULT_COLOR = 257, t7.DIM_OPACITY = 0.5, t7.TEXT_BASELINE = s5.isFirefox || s5.isLegacyEdge ? "bottom" : "ideographic";
      }, 6171: (e11, t7) => {
        function i9(e12) {
          return 57508 <= e12 && e12 <= 57558;
        }
        Object.defineProperty(t7, "__esModule", { value: true }), t7.createRenderDimensions = t7.excludeFromContrastRatioDemands = t7.isRestrictedPowerlineGlyph = t7.isPowerlineGlyph = t7.throwIfFalsy = void 0, t7.throwIfFalsy = function(e12) {
          if (!e12) throw new Error("value must not be falsy");
          return e12;
        }, t7.isPowerlineGlyph = i9, t7.isRestrictedPowerlineGlyph = function(e12) {
          return 57520 <= e12 && e12 <= 57527;
        }, t7.excludeFromContrastRatioDemands = function(e12) {
          return i9(e12) || (function(e13) {
            return 9472 <= e13 && e13 <= 9631;
          })(e12);
        }, t7.createRenderDimensions = function() {
          return { css: { canvas: { width: 0, height: 0 }, cell: { width: 0, height: 0 } }, device: { canvas: { width: 0, height: 0 }, cell: { width: 0, height: 0 }, char: { width: 0, height: 0, left: 0, top: 0 } } };
        };
      }, 456: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.SelectionModel = void 0, t7.SelectionModel = class {
          constructor(e12) {
            this._bufferService = e12, this.isSelectAllActive = false, this.selectionStartLength = 0;
          }
          clearSelection() {
            this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = false, this.selectionStartLength = 0;
          }
          get finalSelectionStart() {
            return this.isSelectAllActive ? [0, 0] : this.selectionEnd && this.selectionStart && this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
          }
          get finalSelectionEnd() {
            if (this.isSelectAllActive) return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
            if (this.selectionStart) {
              if (!this.selectionEnd || this.areSelectionValuesReversed()) {
                const e12 = this.selectionStart[0] + this.selectionStartLength;
                return e12 > this._bufferService.cols ? e12 % this._bufferService.cols == 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(e12 / this._bufferService.cols) - 1] : [e12 % this._bufferService.cols, this.selectionStart[1] + Math.floor(e12 / this._bufferService.cols)] : [e12, this.selectionStart[1]];
              }
              if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
                const e12 = this.selectionStart[0] + this.selectionStartLength;
                return e12 > this._bufferService.cols ? [e12 % this._bufferService.cols, this.selectionStart[1] + Math.floor(e12 / this._bufferService.cols)] : [Math.max(e12, this.selectionEnd[0]), this.selectionEnd[1]];
              }
              return this.selectionEnd;
            }
          }
          areSelectionValuesReversed() {
            const e12 = this.selectionStart, t8 = this.selectionEnd;
            return !(!e12 || !t8) && (e12[1] > t8[1] || e12[1] === t8[1] && e12[0] > t8[0]);
          }
          handleTrim(e12) {
            return this.selectionStart && (this.selectionStart[1] -= e12), this.selectionEnd && (this.selectionEnd[1] -= e12), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
          }
        };
      }, 428: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CharSizeService = void 0;
        const n6 = i9(2585), o10 = i9(8460), a4 = i9(844);
        let h4 = t7.CharSizeService = class extends a4.Disposable {
          get hasValidSize() {
            return this.width > 0 && this.height > 0;
          }
          constructor(e12, t8, i10) {
            super(), this._optionsService = i10, this.width = 0, this.height = 0, this._onCharSizeChange = this.register(new o10.EventEmitter()), this.onCharSizeChange = this._onCharSizeChange.event, this._measureStrategy = new c5(e12, t8, this._optionsService), this.register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], (() => this.measure())));
          }
          measure() {
            const e12 = this._measureStrategy.measure();
            e12.width === this.width && e12.height === this.height || (this.width = e12.width, this.height = e12.height, this._onCharSizeChange.fire());
          }
        };
        t7.CharSizeService = h4 = s5([r11(2, n6.IOptionsService)], h4);
        class c5 {
          constructor(e12, t8, i10) {
            this._document = e12, this._parentElement = t8, this._optionsService = i10, this._result = { width: 0, height: 0 }, this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
          }
          measure() {
            this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`;
            const e12 = { height: Number(this._measureElement.offsetHeight), width: Number(this._measureElement.offsetWidth) };
            return 0 !== e12.width && 0 !== e12.height && (this._result.width = e12.width / 32, this._result.height = Math.ceil(e12.height)), this._result;
          }
        }
      }, 4269: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CharacterJoinerService = t7.JoinedCellData = void 0;
        const n6 = i9(3734), o10 = i9(643), a4 = i9(511), h4 = i9(2585);
        class c5 extends n6.AttributeData {
          constructor(e12, t8, i10) {
            super(), this.content = 0, this.combinedData = "", this.fg = e12.fg, this.bg = e12.bg, this.combinedData = t8, this._width = i10;
          }
          isCombined() {
            return 2097152;
          }
          getWidth() {
            return this._width;
          }
          getChars() {
            return this.combinedData;
          }
          getCode() {
            return 2097151;
          }
          setFromCharData(e12) {
            throw new Error("not implemented");
          }
          getAsCharData() {
            return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
          }
        }
        t7.JoinedCellData = c5;
        let l6 = t7.CharacterJoinerService = class e12 {
          constructor(e13) {
            this._bufferService = e13, this._characterJoiners = [], this._nextCharacterJoinerId = 0, this._workCell = new a4.CellData();
          }
          register(e13) {
            const t8 = { id: this._nextCharacterJoinerId++, handler: e13 };
            return this._characterJoiners.push(t8), t8.id;
          }
          deregister(e13) {
            for (let t8 = 0; t8 < this._characterJoiners.length; t8++) if (this._characterJoiners[t8].id === e13) return this._characterJoiners.splice(t8, 1), true;
            return false;
          }
          getJoinedCharacters(e13) {
            if (0 === this._characterJoiners.length) return [];
            const t8 = this._bufferService.buffer.lines.get(e13);
            if (!t8 || 0 === t8.length) return [];
            const i10 = [], s6 = t8.translateToString(true);
            let r12 = 0, n7 = 0, a5 = 0, h5 = t8.getFg(0), c6 = t8.getBg(0);
            for (let e14 = 0; e14 < t8.getTrimmedLength(); e14++) if (t8.loadCell(e14, this._workCell), 0 !== this._workCell.getWidth()) {
              if (this._workCell.fg !== h5 || this._workCell.bg !== c6) {
                if (e14 - r12 > 1) {
                  const e15 = this._getJoinedRanges(s6, a5, n7, t8, r12);
                  for (let t9 = 0; t9 < e15.length; t9++) i10.push(e15[t9]);
                }
                r12 = e14, a5 = n7, h5 = this._workCell.fg, c6 = this._workCell.bg;
              }
              n7 += this._workCell.getChars().length || o10.WHITESPACE_CELL_CHAR.length;
            }
            if (this._bufferService.cols - r12 > 1) {
              const e14 = this._getJoinedRanges(s6, a5, n7, t8, r12);
              for (let t9 = 0; t9 < e14.length; t9++) i10.push(e14[t9]);
            }
            return i10;
          }
          _getJoinedRanges(t8, i10, s6, r12, n7) {
            const o11 = t8.substring(i10, s6);
            let a5 = [];
            try {
              a5 = this._characterJoiners[0].handler(o11);
            } catch (e13) {
              console.error(e13);
            }
            for (let t9 = 1; t9 < this._characterJoiners.length; t9++) try {
              const i11 = this._characterJoiners[t9].handler(o11);
              for (let t10 = 0; t10 < i11.length; t10++) e12._mergeRanges(a5, i11[t10]);
            } catch (e13) {
              console.error(e13);
            }
            return this._stringRangesToCellRanges(a5, r12, n7), a5;
          }
          _stringRangesToCellRanges(e13, t8, i10) {
            let s6 = 0, r12 = false, n7 = 0, a5 = e13[s6];
            if (a5) {
              for (let h5 = i10; h5 < this._bufferService.cols; h5++) {
                const i11 = t8.getWidth(h5), c6 = t8.getString(h5).length || o10.WHITESPACE_CELL_CHAR.length;
                if (0 !== i11) {
                  if (!r12 && a5[0] <= n7 && (a5[0] = h5, r12 = true), a5[1] <= n7) {
                    if (a5[1] = h5, a5 = e13[++s6], !a5) break;
                    a5[0] <= n7 ? (a5[0] = h5, r12 = true) : r12 = false;
                  }
                  n7 += c6;
                }
              }
              a5 && (a5[1] = this._bufferService.cols);
            }
          }
          static _mergeRanges(e13, t8) {
            let i10 = false;
            for (let s6 = 0; s6 < e13.length; s6++) {
              const r12 = e13[s6];
              if (i10) {
                if (t8[1] <= r12[0]) return e13[s6 - 1][1] = t8[1], e13;
                if (t8[1] <= r12[1]) return e13[s6 - 1][1] = Math.max(t8[1], r12[1]), e13.splice(s6, 1), e13;
                e13.splice(s6, 1), s6--;
              } else {
                if (t8[1] <= r12[0]) return e13.splice(s6, 0, t8), e13;
                if (t8[1] <= r12[1]) return r12[0] = Math.min(t8[0], r12[0]), e13;
                t8[0] < r12[1] && (r12[0] = Math.min(t8[0], r12[0]), i10 = true);
              }
            }
            return i10 ? e13[e13.length - 1][1] = t8[1] : e13.push(t8), e13;
          }
        };
        t7.CharacterJoinerService = l6 = s5([r11(0, h4.IBufferService)], l6);
      }, 5114: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CoreBrowserService = void 0, t7.CoreBrowserService = class {
          constructor(e12, t8) {
            this._textarea = e12, this.window = t8, this._isFocused = false, this._cachedIsFocused = void 0, this._textarea.addEventListener("focus", (() => this._isFocused = true)), this._textarea.addEventListener("blur", (() => this._isFocused = false));
          }
          get dpr() {
            return this.window.devicePixelRatio;
          }
          get isFocused() {
            return void 0 === this._cachedIsFocused && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask((() => this._cachedIsFocused = void 0))), this._cachedIsFocused;
          }
        };
      }, 8934: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.MouseService = void 0;
        const n6 = i9(4725), o10 = i9(9806);
        let a4 = t7.MouseService = class {
          constructor(e12, t8) {
            this._renderService = e12, this._charSizeService = t8;
          }
          getCoords(e12, t8, i10, s6, r12) {
            return (0, o10.getCoords)(window, e12, t8, i10, s6, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, r12);
          }
          getMouseReportCoords(e12, t8) {
            const i10 = (0, o10.getCoordsRelativeToElement)(window, e12, t8);
            if (this._charSizeService.hasValidSize) return i10[0] = Math.min(Math.max(i10[0], 0), this._renderService.dimensions.css.canvas.width - 1), i10[1] = Math.min(Math.max(i10[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i10[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i10[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i10[0]), y: Math.floor(i10[1]) };
          }
        };
        t7.MouseService = a4 = s5([r11(0, n6.IRenderService), r11(1, n6.ICharSizeService)], a4);
      }, 3230: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.RenderService = void 0;
        const n6 = i9(3656), o10 = i9(6193), a4 = i9(5596), h4 = i9(4725), c5 = i9(8460), l6 = i9(844), d3 = i9(7226), _3 = i9(2585);
        let u4 = t7.RenderService = class extends l6.Disposable {
          get dimensions() {
            return this._renderer.value.dimensions;
          }
          constructor(e12, t8, i10, s6, r12, h5, _4, u5) {
            if (super(), this._rowCount = e12, this._charSizeService = s6, this._renderer = this.register(new l6.MutableDisposable()), this._pausedResizeTask = new d3.DebouncedIdleTask(), this._isPaused = false, this._needsFullRefresh = false, this._isNextRenderRedrawOnly = true, this._needsSelectionRefresh = false, this._canvasWidth = 0, this._canvasHeight = 0, this._selectionState = { start: void 0, end: void 0, columnSelectMode: false }, this._onDimensionsChange = this.register(new c5.EventEmitter()), this.onDimensionsChange = this._onDimensionsChange.event, this._onRenderedViewportChange = this.register(new c5.EventEmitter()), this.onRenderedViewportChange = this._onRenderedViewportChange.event, this._onRender = this.register(new c5.EventEmitter()), this.onRender = this._onRender.event, this._onRefreshRequest = this.register(new c5.EventEmitter()), this.onRefreshRequest = this._onRefreshRequest.event, this._renderDebouncer = new o10.RenderDebouncer(_4.window, ((e13, t9) => this._renderRows(e13, t9))), this.register(this._renderDebouncer), this._screenDprMonitor = new a4.ScreenDprMonitor(_4.window), this._screenDprMonitor.setListener((() => this.handleDevicePixelRatioChange())), this.register(this._screenDprMonitor), this.register(h5.onResize((() => this._fullRefresh()))), this.register(h5.buffers.onBufferActivate((() => {
              var e13;
              return null === (e13 = this._renderer.value) || void 0 === e13 ? void 0 : e13.clear();
            }))), this.register(i10.onOptionChange((() => this._handleOptionsChanged()))), this.register(this._charSizeService.onCharSizeChange((() => this.handleCharSizeChanged()))), this.register(r12.onDecorationRegistered((() => this._fullRefresh()))), this.register(r12.onDecorationRemoved((() => this._fullRefresh()))), this.register(i10.onMultipleOptionChange(["customGlyphs", "drawBoldTextInBrightColors", "letterSpacing", "lineHeight", "fontFamily", "fontSize", "fontWeight", "fontWeightBold", "minimumContrastRatio"], (() => {
              this.clear(), this.handleResize(h5.cols, h5.rows), this._fullRefresh();
            }))), this.register(i10.onMultipleOptionChange(["cursorBlink", "cursorStyle"], (() => this.refreshRows(h5.buffer.y, h5.buffer.y, true)))), this.register((0, n6.addDisposableDomListener)(_4.window, "resize", (() => this.handleDevicePixelRatioChange()))), this.register(u5.onChangeColors((() => this._fullRefresh()))), "IntersectionObserver" in _4.window) {
              const e13 = new _4.window.IntersectionObserver(((e14) => this._handleIntersectionChange(e14[e14.length - 1])), { threshold: 0 });
              e13.observe(t8), this.register({ dispose: () => e13.disconnect() });
            }
          }
          _handleIntersectionChange(e12) {
            this._isPaused = void 0 === e12.isIntersecting ? 0 === e12.intersectionRatio : !e12.isIntersecting, this._isPaused || this._charSizeService.hasValidSize || this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = false);
          }
          refreshRows(e12, t8, i10 = false) {
            this._isPaused ? this._needsFullRefresh = true : (i10 || (this._isNextRenderRedrawOnly = false), this._renderDebouncer.refresh(e12, t8, this._rowCount));
          }
          _renderRows(e12, t8) {
            this._renderer.value && (e12 = Math.min(e12, this._rowCount - 1), t8 = Math.min(t8, this._rowCount - 1), this._renderer.value.renderRows(e12, t8), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = false), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({ start: e12, end: t8 }), this._onRender.fire({ start: e12, end: t8 }), this._isNextRenderRedrawOnly = true);
          }
          resize(e12, t8) {
            this._rowCount = t8, this._fireOnCanvasResize();
          }
          _handleOptionsChanged() {
            this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
          }
          _fireOnCanvasResize() {
            this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
          }
          hasRenderer() {
            return !!this._renderer.value;
          }
          setRenderer(e12) {
            this._renderer.value = e12, this._renderer.value.onRequestRedraw(((e13) => this.refreshRows(e13.start, e13.end, true))), this._needsSelectionRefresh = true, this._fullRefresh();
          }
          addRefreshCallback(e12) {
            return this._renderDebouncer.addRefreshCallback(e12);
          }
          _fullRefresh() {
            this._isPaused ? this._needsFullRefresh = true : this.refreshRows(0, this._rowCount - 1);
          }
          clearTextureAtlas() {
            var e12, t8;
            this._renderer.value && (null === (t8 = (e12 = this._renderer.value).clearTextureAtlas) || void 0 === t8 || t8.call(e12), this._fullRefresh());
          }
          handleDevicePixelRatioChange() {
            this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
          }
          handleResize(e12, t8) {
            this._renderer.value && (this._isPaused ? this._pausedResizeTask.set((() => this._renderer.value.handleResize(e12, t8))) : this._renderer.value.handleResize(e12, t8), this._fullRefresh());
          }
          handleCharSizeChanged() {
            var e12;
            null === (e12 = this._renderer.value) || void 0 === e12 || e12.handleCharSizeChanged();
          }
          handleBlur() {
            var e12;
            null === (e12 = this._renderer.value) || void 0 === e12 || e12.handleBlur();
          }
          handleFocus() {
            var e12;
            null === (e12 = this._renderer.value) || void 0 === e12 || e12.handleFocus();
          }
          handleSelectionChanged(e12, t8, i10) {
            var s6;
            this._selectionState.start = e12, this._selectionState.end = t8, this._selectionState.columnSelectMode = i10, null === (s6 = this._renderer.value) || void 0 === s6 || s6.handleSelectionChanged(e12, t8, i10);
          }
          handleCursorMove() {
            var e12;
            null === (e12 = this._renderer.value) || void 0 === e12 || e12.handleCursorMove();
          }
          clear() {
            var e12;
            null === (e12 = this._renderer.value) || void 0 === e12 || e12.clear();
          }
        };
        t7.RenderService = u4 = s5([r11(2, _3.IOptionsService), r11(3, h4.ICharSizeService), r11(4, _3.IDecorationService), r11(5, _3.IBufferService), r11(6, h4.ICoreBrowserService), r11(7, h4.IThemeService)], u4);
      }, 9312: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.SelectionService = void 0;
        const n6 = i9(9806), o10 = i9(9504), a4 = i9(456), h4 = i9(4725), c5 = i9(8460), l6 = i9(844), d3 = i9(6114), _3 = i9(4841), u4 = i9(511), f3 = i9(2585), v2 = String.fromCharCode(160), p4 = new RegExp(v2, "g");
        let g2 = t7.SelectionService = class extends l6.Disposable {
          constructor(e12, t8, i10, s6, r12, n7, o11, h5, d4) {
            super(), this._element = e12, this._screenElement = t8, this._linkifier = i10, this._bufferService = s6, this._coreService = r12, this._mouseService = n7, this._optionsService = o11, this._renderService = h5, this._coreBrowserService = d4, this._dragScrollAmount = 0, this._enabled = true, this._workCell = new u4.CellData(), this._mouseDownTimeStamp = 0, this._oldHasSelection = false, this._oldSelectionStart = void 0, this._oldSelectionEnd = void 0, this._onLinuxMouseSelection = this.register(new c5.EventEmitter()), this.onLinuxMouseSelection = this._onLinuxMouseSelection.event, this._onRedrawRequest = this.register(new c5.EventEmitter()), this.onRequestRedraw = this._onRedrawRequest.event, this._onSelectionChange = this.register(new c5.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onRequestScrollLines = this.register(new c5.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this._mouseMoveListener = (e13) => this._handleMouseMove(e13), this._mouseUpListener = (e13) => this._handleMouseUp(e13), this._coreService.onUserInput((() => {
              this.hasSelection && this.clearSelection();
            })), this._trimListener = this._bufferService.buffer.lines.onTrim(((e13) => this._handleTrim(e13))), this.register(this._bufferService.buffers.onBufferActivate(((e13) => this._handleBufferActivate(e13)))), this.enable(), this._model = new a4.SelectionModel(this._bufferService), this._activeSelectionMode = 0, this.register((0, l6.toDisposable)((() => {
              this._removeMouseDownListeners();
            })));
          }
          reset() {
            this.clearSelection();
          }
          disable() {
            this.clearSelection(), this._enabled = false;
          }
          enable() {
            this._enabled = true;
          }
          get selectionStart() {
            return this._model.finalSelectionStart;
          }
          get selectionEnd() {
            return this._model.finalSelectionEnd;
          }
          get hasSelection() {
            const e12 = this._model.finalSelectionStart, t8 = this._model.finalSelectionEnd;
            return !(!e12 || !t8 || e12[0] === t8[0] && e12[1] === t8[1]);
          }
          get selectionText() {
            const e12 = this._model.finalSelectionStart, t8 = this._model.finalSelectionEnd;
            if (!e12 || !t8) return "";
            const i10 = this._bufferService.buffer, s6 = [];
            if (3 === this._activeSelectionMode) {
              if (e12[0] === t8[0]) return "";
              const r12 = e12[0] < t8[0] ? e12[0] : t8[0], n7 = e12[0] < t8[0] ? t8[0] : e12[0];
              for (let o11 = e12[1]; o11 <= t8[1]; o11++) {
                const e13 = i10.translateBufferLineToString(o11, true, r12, n7);
                s6.push(e13);
              }
            } else {
              const r12 = e12[1] === t8[1] ? t8[0] : void 0;
              s6.push(i10.translateBufferLineToString(e12[1], true, e12[0], r12));
              for (let r13 = e12[1] + 1; r13 <= t8[1] - 1; r13++) {
                const e13 = i10.lines.get(r13), t9 = i10.translateBufferLineToString(r13, true);
                (null == e13 ? void 0 : e13.isWrapped) ? s6[s6.length - 1] += t9 : s6.push(t9);
              }
              if (e12[1] !== t8[1]) {
                const e13 = i10.lines.get(t8[1]), r13 = i10.translateBufferLineToString(t8[1], true, 0, t8[0]);
                e13 && e13.isWrapped ? s6[s6.length - 1] += r13 : s6.push(r13);
              }
            }
            return s6.map(((e13) => e13.replace(p4, " "))).join(d3.isWindows ? "\r\n" : "\n");
          }
          clearSelection() {
            this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
          }
          refresh(e12) {
            this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame((() => this._refresh()))), d3.isLinux && e12 && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
          }
          _refresh() {
            this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({ start: this._model.finalSelectionStart, end: this._model.finalSelectionEnd, columnSelectMode: 3 === this._activeSelectionMode });
          }
          _isClickInSelection(e12) {
            const t8 = this._getMouseBufferCoords(e12), i10 = this._model.finalSelectionStart, s6 = this._model.finalSelectionEnd;
            return !!(i10 && s6 && t8) && this._areCoordsInSelection(t8, i10, s6);
          }
          isCellInSelection(e12, t8) {
            const i10 = this._model.finalSelectionStart, s6 = this._model.finalSelectionEnd;
            return !(!i10 || !s6) && this._areCoordsInSelection([e12, t8], i10, s6);
          }
          _areCoordsInSelection(e12, t8, i10) {
            return e12[1] > t8[1] && e12[1] < i10[1] || t8[1] === i10[1] && e12[1] === t8[1] && e12[0] >= t8[0] && e12[0] < i10[0] || t8[1] < i10[1] && e12[1] === i10[1] && e12[0] < i10[0] || t8[1] < i10[1] && e12[1] === t8[1] && e12[0] >= t8[0];
          }
          _selectWordAtCursor(e12, t8) {
            var i10, s6;
            const r12 = null === (s6 = null === (i10 = this._linkifier.currentLink) || void 0 === i10 ? void 0 : i10.link) || void 0 === s6 ? void 0 : s6.range;
            if (r12) return this._model.selectionStart = [r12.start.x - 1, r12.start.y - 1], this._model.selectionStartLength = (0, _3.getRangeLength)(r12, this._bufferService.cols), this._model.selectionEnd = void 0, true;
            const n7 = this._getMouseBufferCoords(e12);
            return !!n7 && (this._selectWordAt(n7, t8), this._model.selectionEnd = void 0, true);
          }
          selectAll() {
            this._model.isSelectAllActive = true, this.refresh(), this._onSelectionChange.fire();
          }
          selectLines(e12, t8) {
            this._model.clearSelection(), e12 = Math.max(e12, 0), t8 = Math.min(t8, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e12], this._model.selectionEnd = [this._bufferService.cols, t8], this.refresh(), this._onSelectionChange.fire();
          }
          _handleTrim(e12) {
            this._model.handleTrim(e12) && this.refresh();
          }
          _getMouseBufferCoords(e12) {
            const t8 = this._mouseService.getCoords(e12, this._screenElement, this._bufferService.cols, this._bufferService.rows, true);
            if (t8) return t8[0]--, t8[1]--, t8[1] += this._bufferService.buffer.ydisp, t8;
          }
          _getMouseEventScrollAmount(e12) {
            let t8 = (0, n6.getCoordsRelativeToElement)(this._coreBrowserService.window, e12, this._screenElement)[1];
            const i10 = this._renderService.dimensions.css.canvas.height;
            return t8 >= 0 && t8 <= i10 ? 0 : (t8 > i10 && (t8 -= i10), t8 = Math.min(Math.max(t8, -50), 50), t8 /= 50, t8 / Math.abs(t8) + Math.round(14 * t8));
          }
          shouldForceSelection(e12) {
            return d3.isMac ? e12.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e12.shiftKey;
          }
          handleMouseDown(e12) {
            if (this._mouseDownTimeStamp = e12.timeStamp, (2 !== e12.button || !this.hasSelection) && 0 === e12.button) {
              if (!this._enabled) {
                if (!this.shouldForceSelection(e12)) return;
                e12.stopPropagation();
              }
              e12.preventDefault(), this._dragScrollAmount = 0, this._enabled && e12.shiftKey ? this._handleIncrementalClick(e12) : 1 === e12.detail ? this._handleSingleClick(e12) : 2 === e12.detail ? this._handleDoubleClick(e12) : 3 === e12.detail && this._handleTripleClick(e12), this._addMouseDownListeners(), this.refresh(true);
            }
          }
          _addMouseDownListeners() {
            this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval((() => this._dragScroll()), 50);
          }
          _removeMouseDownListeners() {
            this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
          }
          _handleIncrementalClick(e12) {
            this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e12));
          }
          _handleSingleClick(e12) {
            if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = false, this._activeSelectionMode = this.shouldColumnSelect(e12) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e12), !this._model.selectionStart) return;
            this._model.selectionEnd = void 0;
            const t8 = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
            t8 && t8.length !== this._model.selectionStart[0] && 0 === t8.hasWidth(this._model.selectionStart[0]) && this._model.selectionStart[0]++;
          }
          _handleDoubleClick(e12) {
            this._selectWordAtCursor(e12, true) && (this._activeSelectionMode = 1);
          }
          _handleTripleClick(e12) {
            const t8 = this._getMouseBufferCoords(e12);
            t8 && (this._activeSelectionMode = 2, this._selectLineAt(t8[1]));
          }
          shouldColumnSelect(e12) {
            return e12.altKey && !(d3.isMac && this._optionsService.rawOptions.macOptionClickForcesSelection);
          }
          _handleMouseMove(e12) {
            if (e12.stopImmediatePropagation(), !this._model.selectionStart) return;
            const t8 = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
            if (this._model.selectionEnd = this._getMouseBufferCoords(e12), !this._model.selectionEnd) return void this.refresh(true);
            2 === this._activeSelectionMode ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : 1 === this._activeSelectionMode && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e12), 3 !== this._activeSelectionMode && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
            const i10 = this._bufferService.buffer;
            if (this._model.selectionEnd[1] < i10.lines.length) {
              const e13 = i10.lines.get(this._model.selectionEnd[1]);
              e13 && 0 === e13.hasWidth(this._model.selectionEnd[0]) && this._model.selectionEnd[0]++;
            }
            t8 && t8[0] === this._model.selectionEnd[0] && t8[1] === this._model.selectionEnd[1] || this.refresh(true);
          }
          _dragScroll() {
            if (this._model.selectionEnd && this._model.selectionStart && this._dragScrollAmount) {
              this._onRequestScrollLines.fire({ amount: this._dragScrollAmount, suppressScrollEvent: false });
              const e12 = this._bufferService.buffer;
              this._dragScrollAmount > 0 ? (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e12.ydisp + this._bufferService.rows, e12.lines.length - 1)) : (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e12.ydisp), this.refresh();
            }
          }
          _handleMouseUp(e12) {
            const t8 = e12.timeStamp - this._mouseDownTimeStamp;
            if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && t8 < 500 && e12.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
              if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
                const t9 = this._mouseService.getCoords(e12, this._element, this._bufferService.cols, this._bufferService.rows, false);
                if (t9 && void 0 !== t9[0] && void 0 !== t9[1]) {
                  const e13 = (0, o10.moveToCellSequence)(t9[0] - 1, t9[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
                  this._coreService.triggerDataEvent(e13, true);
                }
              }
            } else this._fireEventIfSelectionChanged();
          }
          _fireEventIfSelectionChanged() {
            const e12 = this._model.finalSelectionStart, t8 = this._model.finalSelectionEnd, i10 = !(!e12 || !t8 || e12[0] === t8[0] && e12[1] === t8[1]);
            i10 ? e12 && t8 && (this._oldSelectionStart && this._oldSelectionEnd && e12[0] === this._oldSelectionStart[0] && e12[1] === this._oldSelectionStart[1] && t8[0] === this._oldSelectionEnd[0] && t8[1] === this._oldSelectionEnd[1] || this._fireOnSelectionChange(e12, t8, i10)) : this._oldHasSelection && this._fireOnSelectionChange(e12, t8, i10);
          }
          _fireOnSelectionChange(e12, t8, i10) {
            this._oldSelectionStart = e12, this._oldSelectionEnd = t8, this._oldHasSelection = i10, this._onSelectionChange.fire();
          }
          _handleBufferActivate(e12) {
            this.clearSelection(), this._trimListener.dispose(), this._trimListener = e12.activeBuffer.lines.onTrim(((e13) => this._handleTrim(e13)));
          }
          _convertViewportColToCharacterIndex(e12, t8) {
            let i10 = t8;
            for (let s6 = 0; t8 >= s6; s6++) {
              const r12 = e12.loadCell(s6, this._workCell).getChars().length;
              0 === this._workCell.getWidth() ? i10-- : r12 > 1 && t8 !== s6 && (i10 += r12 - 1);
            }
            return i10;
          }
          setSelection(e12, t8, i10) {
            this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e12, t8], this._model.selectionStartLength = i10, this.refresh(), this._fireEventIfSelectionChanged();
          }
          rightClickSelect(e12) {
            this._isClickInSelection(e12) || (this._selectWordAtCursor(e12, false) && this.refresh(true), this._fireEventIfSelectionChanged());
          }
          _getWordAt(e12, t8, i10 = true, s6 = true) {
            if (e12[0] >= this._bufferService.cols) return;
            const r12 = this._bufferService.buffer, n7 = r12.lines.get(e12[1]);
            if (!n7) return;
            const o11 = r12.translateBufferLineToString(e12[1], false);
            let a5 = this._convertViewportColToCharacterIndex(n7, e12[0]), h5 = a5;
            const c6 = e12[0] - a5;
            let l7 = 0, d4 = 0, _4 = 0, u5 = 0;
            if (" " === o11.charAt(a5)) {
              for (; a5 > 0 && " " === o11.charAt(a5 - 1); ) a5--;
              for (; h5 < o11.length && " " === o11.charAt(h5 + 1); ) h5++;
            } else {
              let t9 = e12[0], i11 = e12[0];
              0 === n7.getWidth(t9) && (l7++, t9--), 2 === n7.getWidth(i11) && (d4++, i11++);
              const s7 = n7.getString(i11).length;
              for (s7 > 1 && (u5 += s7 - 1, h5 += s7 - 1); t9 > 0 && a5 > 0 && !this._isCharWordSeparator(n7.loadCell(t9 - 1, this._workCell)); ) {
                n7.loadCell(t9 - 1, this._workCell);
                const e13 = this._workCell.getChars().length;
                0 === this._workCell.getWidth() ? (l7++, t9--) : e13 > 1 && (_4 += e13 - 1, a5 -= e13 - 1), a5--, t9--;
              }
              for (; i11 < n7.length && h5 + 1 < o11.length && !this._isCharWordSeparator(n7.loadCell(i11 + 1, this._workCell)); ) {
                n7.loadCell(i11 + 1, this._workCell);
                const e13 = this._workCell.getChars().length;
                2 === this._workCell.getWidth() ? (d4++, i11++) : e13 > 1 && (u5 += e13 - 1, h5 += e13 - 1), h5++, i11++;
              }
            }
            h5++;
            let f4 = a5 + c6 - l7 + _4, v3 = Math.min(this._bufferService.cols, h5 - a5 + l7 + d4 - _4 - u5);
            if (t8 || "" !== o11.slice(a5, h5).trim()) {
              if (i10 && 0 === f4 && 32 !== n7.getCodePoint(0)) {
                const t9 = r12.lines.get(e12[1] - 1);
                if (t9 && n7.isWrapped && 32 !== t9.getCodePoint(this._bufferService.cols - 1)) {
                  const t10 = this._getWordAt([this._bufferService.cols - 1, e12[1] - 1], false, true, false);
                  if (t10) {
                    const e13 = this._bufferService.cols - t10.start;
                    f4 -= e13, v3 += e13;
                  }
                }
              }
              if (s6 && f4 + v3 === this._bufferService.cols && 32 !== n7.getCodePoint(this._bufferService.cols - 1)) {
                const t9 = r12.lines.get(e12[1] + 1);
                if ((null == t9 ? void 0 : t9.isWrapped) && 32 !== t9.getCodePoint(0)) {
                  const t10 = this._getWordAt([0, e12[1] + 1], false, false, true);
                  t10 && (v3 += t10.length);
                }
              }
              return { start: f4, length: v3 };
            }
          }
          _selectWordAt(e12, t8) {
            const i10 = this._getWordAt(e12, t8);
            if (i10) {
              for (; i10.start < 0; ) i10.start += this._bufferService.cols, e12[1]--;
              this._model.selectionStart = [i10.start, e12[1]], this._model.selectionStartLength = i10.length;
            }
          }
          _selectToWordAt(e12) {
            const t8 = this._getWordAt(e12, true);
            if (t8) {
              let i10 = e12[1];
              for (; t8.start < 0; ) t8.start += this._bufferService.cols, i10--;
              if (!this._model.areSelectionValuesReversed()) for (; t8.start + t8.length > this._bufferService.cols; ) t8.length -= this._bufferService.cols, i10++;
              this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? t8.start : t8.start + t8.length, i10];
            }
          }
          _isCharWordSeparator(e12) {
            return 0 !== e12.getWidth() && this._optionsService.rawOptions.wordSeparator.indexOf(e12.getChars()) >= 0;
          }
          _selectLineAt(e12) {
            const t8 = this._bufferService.buffer.getWrappedRangeForLine(e12), i10 = { start: { x: 0, y: t8.first }, end: { x: this._bufferService.cols - 1, y: t8.last } };
            this._model.selectionStart = [0, t8.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = (0, _3.getRangeLength)(i10, this._bufferService.cols);
          }
        };
        t7.SelectionService = g2 = s5([r11(3, f3.IBufferService), r11(4, f3.ICoreService), r11(5, h4.IMouseService), r11(6, f3.IOptionsService), r11(7, h4.IRenderService), r11(8, h4.ICoreBrowserService)], g2);
      }, 4725: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.IThemeService = t7.ICharacterJoinerService = t7.ISelectionService = t7.IRenderService = t7.IMouseService = t7.ICoreBrowserService = t7.ICharSizeService = void 0;
        const s5 = i9(8343);
        t7.ICharSizeService = (0, s5.createDecorator)("CharSizeService"), t7.ICoreBrowserService = (0, s5.createDecorator)("CoreBrowserService"), t7.IMouseService = (0, s5.createDecorator)("MouseService"), t7.IRenderService = (0, s5.createDecorator)("RenderService"), t7.ISelectionService = (0, s5.createDecorator)("SelectionService"), t7.ICharacterJoinerService = (0, s5.createDecorator)("CharacterJoinerService"), t7.IThemeService = (0, s5.createDecorator)("ThemeService");
      }, 6731: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.ThemeService = t7.DEFAULT_ANSI_COLORS = void 0;
        const n6 = i9(7239), o10 = i9(8055), a4 = i9(8460), h4 = i9(844), c5 = i9(2585), l6 = o10.css.toColor("#ffffff"), d3 = o10.css.toColor("#000000"), _3 = o10.css.toColor("#ffffff"), u4 = o10.css.toColor("#000000"), f3 = { css: "rgba(255, 255, 255, 0.3)", rgba: 4294967117 };
        t7.DEFAULT_ANSI_COLORS = Object.freeze((() => {
          const e12 = [o10.css.toColor("#2e3436"), o10.css.toColor("#cc0000"), o10.css.toColor("#4e9a06"), o10.css.toColor("#c4a000"), o10.css.toColor("#3465a4"), o10.css.toColor("#75507b"), o10.css.toColor("#06989a"), o10.css.toColor("#d3d7cf"), o10.css.toColor("#555753"), o10.css.toColor("#ef2929"), o10.css.toColor("#8ae234"), o10.css.toColor("#fce94f"), o10.css.toColor("#729fcf"), o10.css.toColor("#ad7fa8"), o10.css.toColor("#34e2e2"), o10.css.toColor("#eeeeec")], t8 = [0, 95, 135, 175, 215, 255];
          for (let i10 = 0; i10 < 216; i10++) {
            const s6 = t8[i10 / 36 % 6 | 0], r12 = t8[i10 / 6 % 6 | 0], n7 = t8[i10 % 6];
            e12.push({ css: o10.channels.toCss(s6, r12, n7), rgba: o10.channels.toRgba(s6, r12, n7) });
          }
          for (let t9 = 0; t9 < 24; t9++) {
            const i10 = 8 + 10 * t9;
            e12.push({ css: o10.channels.toCss(i10, i10, i10), rgba: o10.channels.toRgba(i10, i10, i10) });
          }
          return e12;
        })());
        let v2 = t7.ThemeService = class extends h4.Disposable {
          get colors() {
            return this._colors;
          }
          constructor(e12) {
            super(), this._optionsService = e12, this._contrastCache = new n6.ColorContrastCache(), this._halfContrastCache = new n6.ColorContrastCache(), this._onChangeColors = this.register(new a4.EventEmitter()), this.onChangeColors = this._onChangeColors.event, this._colors = { foreground: l6, background: d3, cursor: _3, cursorAccent: u4, selectionForeground: void 0, selectionBackgroundTransparent: f3, selectionBackgroundOpaque: o10.color.blend(d3, f3), selectionInactiveBackgroundTransparent: f3, selectionInactiveBackgroundOpaque: o10.color.blend(d3, f3), ansi: t7.DEFAULT_ANSI_COLORS.slice(), contrastCache: this._contrastCache, halfContrastCache: this._halfContrastCache }, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", (() => this._contrastCache.clear()))), this.register(this._optionsService.onSpecificOptionChange("theme", (() => this._setTheme(this._optionsService.rawOptions.theme))));
          }
          _setTheme(e12 = {}) {
            const i10 = this._colors;
            if (i10.foreground = p4(e12.foreground, l6), i10.background = p4(e12.background, d3), i10.cursor = p4(e12.cursor, _3), i10.cursorAccent = p4(e12.cursorAccent, u4), i10.selectionBackgroundTransparent = p4(e12.selectionBackground, f3), i10.selectionBackgroundOpaque = o10.color.blend(i10.background, i10.selectionBackgroundTransparent), i10.selectionInactiveBackgroundTransparent = p4(e12.selectionInactiveBackground, i10.selectionBackgroundTransparent), i10.selectionInactiveBackgroundOpaque = o10.color.blend(i10.background, i10.selectionInactiveBackgroundTransparent), i10.selectionForeground = e12.selectionForeground ? p4(e12.selectionForeground, o10.NULL_COLOR) : void 0, i10.selectionForeground === o10.NULL_COLOR && (i10.selectionForeground = void 0), o10.color.isOpaque(i10.selectionBackgroundTransparent)) {
              const e13 = 0.3;
              i10.selectionBackgroundTransparent = o10.color.opacity(i10.selectionBackgroundTransparent, e13);
            }
            if (o10.color.isOpaque(i10.selectionInactiveBackgroundTransparent)) {
              const e13 = 0.3;
              i10.selectionInactiveBackgroundTransparent = o10.color.opacity(i10.selectionInactiveBackgroundTransparent, e13);
            }
            if (i10.ansi = t7.DEFAULT_ANSI_COLORS.slice(), i10.ansi[0] = p4(e12.black, t7.DEFAULT_ANSI_COLORS[0]), i10.ansi[1] = p4(e12.red, t7.DEFAULT_ANSI_COLORS[1]), i10.ansi[2] = p4(e12.green, t7.DEFAULT_ANSI_COLORS[2]), i10.ansi[3] = p4(e12.yellow, t7.DEFAULT_ANSI_COLORS[3]), i10.ansi[4] = p4(e12.blue, t7.DEFAULT_ANSI_COLORS[4]), i10.ansi[5] = p4(e12.magenta, t7.DEFAULT_ANSI_COLORS[5]), i10.ansi[6] = p4(e12.cyan, t7.DEFAULT_ANSI_COLORS[6]), i10.ansi[7] = p4(e12.white, t7.DEFAULT_ANSI_COLORS[7]), i10.ansi[8] = p4(e12.brightBlack, t7.DEFAULT_ANSI_COLORS[8]), i10.ansi[9] = p4(e12.brightRed, t7.DEFAULT_ANSI_COLORS[9]), i10.ansi[10] = p4(e12.brightGreen, t7.DEFAULT_ANSI_COLORS[10]), i10.ansi[11] = p4(e12.brightYellow, t7.DEFAULT_ANSI_COLORS[11]), i10.ansi[12] = p4(e12.brightBlue, t7.DEFAULT_ANSI_COLORS[12]), i10.ansi[13] = p4(e12.brightMagenta, t7.DEFAULT_ANSI_COLORS[13]), i10.ansi[14] = p4(e12.brightCyan, t7.DEFAULT_ANSI_COLORS[14]), i10.ansi[15] = p4(e12.brightWhite, t7.DEFAULT_ANSI_COLORS[15]), e12.extendedAnsi) {
              const s6 = Math.min(i10.ansi.length - 16, e12.extendedAnsi.length);
              for (let r12 = 0; r12 < s6; r12++) i10.ansi[r12 + 16] = p4(e12.extendedAnsi[r12], t7.DEFAULT_ANSI_COLORS[r12 + 16]);
            }
            this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
          }
          restoreColor(e12) {
            this._restoreColor(e12), this._onChangeColors.fire(this.colors);
          }
          _restoreColor(e12) {
            if (void 0 !== e12) switch (e12) {
              case 256:
                this._colors.foreground = this._restoreColors.foreground;
                break;
              case 257:
                this._colors.background = this._restoreColors.background;
                break;
              case 258:
                this._colors.cursor = this._restoreColors.cursor;
                break;
              default:
                this._colors.ansi[e12] = this._restoreColors.ansi[e12];
            }
            else for (let e13 = 0; e13 < this._restoreColors.ansi.length; ++e13) this._colors.ansi[e13] = this._restoreColors.ansi[e13];
          }
          modifyColors(e12) {
            e12(this._colors), this._onChangeColors.fire(this.colors);
          }
          _updateRestoreColors() {
            this._restoreColors = { foreground: this._colors.foreground, background: this._colors.background, cursor: this._colors.cursor, ansi: this._colors.ansi.slice() };
          }
        };
        function p4(e12, t8) {
          if (void 0 !== e12) try {
            return o10.css.toColor(e12);
          } catch (e13) {
          }
          return t8;
        }
        t7.ThemeService = v2 = s5([r11(0, c5.IOptionsService)], v2);
      }, 6349: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CircularList = void 0;
        const s5 = i9(8460), r11 = i9(844);
        class n6 extends r11.Disposable {
          constructor(e12) {
            super(), this._maxLength = e12, this.onDeleteEmitter = this.register(new s5.EventEmitter()), this.onDelete = this.onDeleteEmitter.event, this.onInsertEmitter = this.register(new s5.EventEmitter()), this.onInsert = this.onInsertEmitter.event, this.onTrimEmitter = this.register(new s5.EventEmitter()), this.onTrim = this.onTrimEmitter.event, this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
          }
          get maxLength() {
            return this._maxLength;
          }
          set maxLength(e12) {
            if (this._maxLength === e12) return;
            const t8 = new Array(e12);
            for (let i10 = 0; i10 < Math.min(e12, this.length); i10++) t8[i10] = this._array[this._getCyclicIndex(i10)];
            this._array = t8, this._maxLength = e12, this._startIndex = 0;
          }
          get length() {
            return this._length;
          }
          set length(e12) {
            if (e12 > this._length) for (let t8 = this._length; t8 < e12; t8++) this._array[t8] = void 0;
            this._length = e12;
          }
          get(e12) {
            return this._array[this._getCyclicIndex(e12)];
          }
          set(e12, t8) {
            this._array[this._getCyclicIndex(e12)] = t8;
          }
          push(e12) {
            this._array[this._getCyclicIndex(this._length)] = e12, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
          }
          recycle() {
            if (this._length !== this._maxLength) throw new Error("Can only recycle when the buffer is full");
            return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
          }
          get isFull() {
            return this._length === this._maxLength;
          }
          pop() {
            return this._array[this._getCyclicIndex(this._length-- - 1)];
          }
          splice(e12, t8, ...i10) {
            if (t8) {
              for (let i11 = e12; i11 < this._length - t8; i11++) this._array[this._getCyclicIndex(i11)] = this._array[this._getCyclicIndex(i11 + t8)];
              this._length -= t8, this.onDeleteEmitter.fire({ index: e12, amount: t8 });
            }
            for (let t9 = this._length - 1; t9 >= e12; t9--) this._array[this._getCyclicIndex(t9 + i10.length)] = this._array[this._getCyclicIndex(t9)];
            for (let t9 = 0; t9 < i10.length; t9++) this._array[this._getCyclicIndex(e12 + t9)] = i10[t9];
            if (i10.length && this.onInsertEmitter.fire({ index: e12, amount: i10.length }), this._length + i10.length > this._maxLength) {
              const e13 = this._length + i10.length - this._maxLength;
              this._startIndex += e13, this._length = this._maxLength, this.onTrimEmitter.fire(e13);
            } else this._length += i10.length;
          }
          trimStart(e12) {
            e12 > this._length && (e12 = this._length), this._startIndex += e12, this._length -= e12, this.onTrimEmitter.fire(e12);
          }
          shiftElements(e12, t8, i10) {
            if (!(t8 <= 0)) {
              if (e12 < 0 || e12 >= this._length) throw new Error("start argument out of range");
              if (e12 + i10 < 0) throw new Error("Cannot shift elements in list beyond index 0");
              if (i10 > 0) {
                for (let s7 = t8 - 1; s7 >= 0; s7--) this.set(e12 + s7 + i10, this.get(e12 + s7));
                const s6 = e12 + t8 + i10 - this._length;
                if (s6 > 0) for (this._length += s6; this._length > this._maxLength; ) this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
              } else for (let s6 = 0; s6 < t8; s6++) this.set(e12 + s6 + i10, this.get(e12 + s6));
            }
          }
          _getCyclicIndex(e12) {
            return (this._startIndex + e12) % this._maxLength;
          }
        }
        t7.CircularList = n6;
      }, 1439: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.clone = void 0, t7.clone = function e12(t8, i9 = 5) {
          if ("object" != typeof t8) return t8;
          const s5 = Array.isArray(t8) ? [] : {};
          for (const r11 in t8) s5[r11] = i9 <= 1 ? t8[r11] : t8[r11] && e12(t8[r11], i9 - 1);
          return s5;
        };
      }, 8055: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.contrastRatio = t7.toPaddedHex = t7.rgba = t7.rgb = t7.css = t7.color = t7.channels = t7.NULL_COLOR = void 0;
        const s5 = i9(6114);
        let r11 = 0, n6 = 0, o10 = 0, a4 = 0;
        var h4, c5, l6, d3, _3;
        function u4(e12) {
          const t8 = e12.toString(16);
          return t8.length < 2 ? "0" + t8 : t8;
        }
        function f3(e12, t8) {
          return e12 < t8 ? (t8 + 0.05) / (e12 + 0.05) : (e12 + 0.05) / (t8 + 0.05);
        }
        t7.NULL_COLOR = { css: "#00000000", rgba: 0 }, (function(e12) {
          e12.toCss = function(e13, t8, i10, s6) {
            return void 0 !== s6 ? `#${u4(e13)}${u4(t8)}${u4(i10)}${u4(s6)}` : `#${u4(e13)}${u4(t8)}${u4(i10)}`;
          }, e12.toRgba = function(e13, t8, i10, s6 = 255) {
            return (e13 << 24 | t8 << 16 | i10 << 8 | s6) >>> 0;
          };
        })(h4 || (t7.channels = h4 = {})), (function(e12) {
          function t8(e13, t9) {
            return a4 = Math.round(255 * t9), [r11, n6, o10] = _3.toChannels(e13.rgba), { css: h4.toCss(r11, n6, o10, a4), rgba: h4.toRgba(r11, n6, o10, a4) };
          }
          e12.blend = function(e13, t9) {
            if (a4 = (255 & t9.rgba) / 255, 1 === a4) return { css: t9.css, rgba: t9.rgba };
            const i10 = t9.rgba >> 24 & 255, s6 = t9.rgba >> 16 & 255, c6 = t9.rgba >> 8 & 255, l7 = e13.rgba >> 24 & 255, d4 = e13.rgba >> 16 & 255, _4 = e13.rgba >> 8 & 255;
            return r11 = l7 + Math.round((i10 - l7) * a4), n6 = d4 + Math.round((s6 - d4) * a4), o10 = _4 + Math.round((c6 - _4) * a4), { css: h4.toCss(r11, n6, o10), rgba: h4.toRgba(r11, n6, o10) };
          }, e12.isOpaque = function(e13) {
            return 255 == (255 & e13.rgba);
          }, e12.ensureContrastRatio = function(e13, t9, i10) {
            const s6 = _3.ensureContrastRatio(e13.rgba, t9.rgba, i10);
            if (s6) return _3.toColor(s6 >> 24 & 255, s6 >> 16 & 255, s6 >> 8 & 255);
          }, e12.opaque = function(e13) {
            const t9 = (255 | e13.rgba) >>> 0;
            return [r11, n6, o10] = _3.toChannels(t9), { css: h4.toCss(r11, n6, o10), rgba: t9 };
          }, e12.opacity = t8, e12.multiplyOpacity = function(e13, i10) {
            return a4 = 255 & e13.rgba, t8(e13, a4 * i10 / 255);
          }, e12.toColorRGB = function(e13) {
            return [e13.rgba >> 24 & 255, e13.rgba >> 16 & 255, e13.rgba >> 8 & 255];
          };
        })(c5 || (t7.color = c5 = {})), (function(e12) {
          let t8, i10;
          if (!s5.isNode) {
            const e13 = document.createElement("canvas");
            e13.width = 1, e13.height = 1;
            const s6 = e13.getContext("2d", { willReadFrequently: true });
            s6 && (t8 = s6, t8.globalCompositeOperation = "copy", i10 = t8.createLinearGradient(0, 0, 1, 1));
          }
          e12.toColor = function(e13) {
            if (e13.match(/#[\da-f]{3,8}/i)) switch (e13.length) {
              case 4:
                return r11 = parseInt(e13.slice(1, 2).repeat(2), 16), n6 = parseInt(e13.slice(2, 3).repeat(2), 16), o10 = parseInt(e13.slice(3, 4).repeat(2), 16), _3.toColor(r11, n6, o10);
              case 5:
                return r11 = parseInt(e13.slice(1, 2).repeat(2), 16), n6 = parseInt(e13.slice(2, 3).repeat(2), 16), o10 = parseInt(e13.slice(3, 4).repeat(2), 16), a4 = parseInt(e13.slice(4, 5).repeat(2), 16), _3.toColor(r11, n6, o10, a4);
              case 7:
                return { css: e13, rgba: (parseInt(e13.slice(1), 16) << 8 | 255) >>> 0 };
              case 9:
                return { css: e13, rgba: parseInt(e13.slice(1), 16) >>> 0 };
            }
            const s6 = e13.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
            if (s6) return r11 = parseInt(s6[1]), n6 = parseInt(s6[2]), o10 = parseInt(s6[3]), a4 = Math.round(255 * (void 0 === s6[5] ? 1 : parseFloat(s6[5]))), _3.toColor(r11, n6, o10, a4);
            if (!t8 || !i10) throw new Error("css.toColor: Unsupported css format");
            if (t8.fillStyle = i10, t8.fillStyle = e13, "string" != typeof t8.fillStyle) throw new Error("css.toColor: Unsupported css format");
            if (t8.fillRect(0, 0, 1, 1), [r11, n6, o10, a4] = t8.getImageData(0, 0, 1, 1).data, 255 !== a4) throw new Error("css.toColor: Unsupported css format");
            return { rgba: h4.toRgba(r11, n6, o10, a4), css: e13 };
          };
        })(l6 || (t7.css = l6 = {})), (function(e12) {
          function t8(e13, t9, i10) {
            const s6 = e13 / 255, r12 = t9 / 255, n7 = i10 / 255;
            return 0.2126 * (s6 <= 0.03928 ? s6 / 12.92 : Math.pow((s6 + 0.055) / 1.055, 2.4)) + 0.7152 * (r12 <= 0.03928 ? r12 / 12.92 : Math.pow((r12 + 0.055) / 1.055, 2.4)) + 0.0722 * (n7 <= 0.03928 ? n7 / 12.92 : Math.pow((n7 + 0.055) / 1.055, 2.4));
          }
          e12.relativeLuminance = function(e13) {
            return t8(e13 >> 16 & 255, e13 >> 8 & 255, 255 & e13);
          }, e12.relativeLuminance2 = t8;
        })(d3 || (t7.rgb = d3 = {})), (function(e12) {
          function t8(e13, t9, i11) {
            const s6 = e13 >> 24 & 255, r12 = e13 >> 16 & 255, n7 = e13 >> 8 & 255;
            let o11 = t9 >> 24 & 255, a5 = t9 >> 16 & 255, h5 = t9 >> 8 & 255, c6 = f3(d3.relativeLuminance2(o11, a5, h5), d3.relativeLuminance2(s6, r12, n7));
            for (; c6 < i11 && (o11 > 0 || a5 > 0 || h5 > 0); ) o11 -= Math.max(0, Math.ceil(0.1 * o11)), a5 -= Math.max(0, Math.ceil(0.1 * a5)), h5 -= Math.max(0, Math.ceil(0.1 * h5)), c6 = f3(d3.relativeLuminance2(o11, a5, h5), d3.relativeLuminance2(s6, r12, n7));
            return (o11 << 24 | a5 << 16 | h5 << 8 | 255) >>> 0;
          }
          function i10(e13, t9, i11) {
            const s6 = e13 >> 24 & 255, r12 = e13 >> 16 & 255, n7 = e13 >> 8 & 255;
            let o11 = t9 >> 24 & 255, a5 = t9 >> 16 & 255, h5 = t9 >> 8 & 255, c6 = f3(d3.relativeLuminance2(o11, a5, h5), d3.relativeLuminance2(s6, r12, n7));
            for (; c6 < i11 && (o11 < 255 || a5 < 255 || h5 < 255); ) o11 = Math.min(255, o11 + Math.ceil(0.1 * (255 - o11))), a5 = Math.min(255, a5 + Math.ceil(0.1 * (255 - a5))), h5 = Math.min(255, h5 + Math.ceil(0.1 * (255 - h5))), c6 = f3(d3.relativeLuminance2(o11, a5, h5), d3.relativeLuminance2(s6, r12, n7));
            return (o11 << 24 | a5 << 16 | h5 << 8 | 255) >>> 0;
          }
          e12.ensureContrastRatio = function(e13, s6, r12) {
            const n7 = d3.relativeLuminance(e13 >> 8), o11 = d3.relativeLuminance(s6 >> 8);
            if (f3(n7, o11) < r12) {
              if (o11 < n7) {
                const o12 = t8(e13, s6, r12), a6 = f3(n7, d3.relativeLuminance(o12 >> 8));
                if (a6 < r12) {
                  const t9 = i10(e13, s6, r12);
                  return a6 > f3(n7, d3.relativeLuminance(t9 >> 8)) ? o12 : t9;
                }
                return o12;
              }
              const a5 = i10(e13, s6, r12), h5 = f3(n7, d3.relativeLuminance(a5 >> 8));
              if (h5 < r12) {
                const i11 = t8(e13, s6, r12);
                return h5 > f3(n7, d3.relativeLuminance(i11 >> 8)) ? a5 : i11;
              }
              return a5;
            }
          }, e12.reduceLuminance = t8, e12.increaseLuminance = i10, e12.toChannels = function(e13) {
            return [e13 >> 24 & 255, e13 >> 16 & 255, e13 >> 8 & 255, 255 & e13];
          }, e12.toColor = function(e13, t9, i11, s6) {
            return { css: h4.toCss(e13, t9, i11, s6), rgba: h4.toRgba(e13, t9, i11, s6) };
          };
        })(_3 || (t7.rgba = _3 = {})), t7.toPaddedHex = u4, t7.contrastRatio = f3;
      }, 8969: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CoreTerminal = void 0;
        const s5 = i9(844), r11 = i9(2585), n6 = i9(4348), o10 = i9(7866), a4 = i9(744), h4 = i9(7302), c5 = i9(6975), l6 = i9(8460), d3 = i9(1753), _3 = i9(1480), u4 = i9(7994), f3 = i9(9282), v2 = i9(5435), p4 = i9(5981), g2 = i9(2660);
        let m3 = false;
        class S3 extends s5.Disposable {
          get onScroll() {
            return this._onScrollApi || (this._onScrollApi = this.register(new l6.EventEmitter()), this._onScroll.event(((e12) => {
              var t8;
              null === (t8 = this._onScrollApi) || void 0 === t8 || t8.fire(e12.position);
            }))), this._onScrollApi.event;
          }
          get cols() {
            return this._bufferService.cols;
          }
          get rows() {
            return this._bufferService.rows;
          }
          get buffers() {
            return this._bufferService.buffers;
          }
          get options() {
            return this.optionsService.options;
          }
          set options(e12) {
            for (const t8 in e12) this.optionsService.options[t8] = e12[t8];
          }
          constructor(e12) {
            super(), this._windowsWrappingHeuristics = this.register(new s5.MutableDisposable()), this._onBinary = this.register(new l6.EventEmitter()), this.onBinary = this._onBinary.event, this._onData = this.register(new l6.EventEmitter()), this.onData = this._onData.event, this._onLineFeed = this.register(new l6.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onResize = this.register(new l6.EventEmitter()), this.onResize = this._onResize.event, this._onWriteParsed = this.register(new l6.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event, this._onScroll = this.register(new l6.EventEmitter()), this._instantiationService = new n6.InstantiationService(), this.optionsService = this.register(new h4.OptionsService(e12)), this._instantiationService.setService(r11.IOptionsService, this.optionsService), this._bufferService = this.register(this._instantiationService.createInstance(a4.BufferService)), this._instantiationService.setService(r11.IBufferService, this._bufferService), this._logService = this.register(this._instantiationService.createInstance(o10.LogService)), this._instantiationService.setService(r11.ILogService, this._logService), this.coreService = this.register(this._instantiationService.createInstance(c5.CoreService)), this._instantiationService.setService(r11.ICoreService, this.coreService), this.coreMouseService = this.register(this._instantiationService.createInstance(d3.CoreMouseService)), this._instantiationService.setService(r11.ICoreMouseService, this.coreMouseService), this.unicodeService = this.register(this._instantiationService.createInstance(_3.UnicodeService)), this._instantiationService.setService(r11.IUnicodeService, this.unicodeService), this._charsetService = this._instantiationService.createInstance(u4.CharsetService), this._instantiationService.setService(r11.ICharsetService, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(g2.OscLinkService), this._instantiationService.setService(r11.IOscLinkService, this._oscLinkService), this._inputHandler = this.register(new v2.InputHandler(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this.register((0, l6.forwardEvent)(this._inputHandler.onLineFeed, this._onLineFeed)), this.register(this._inputHandler), this.register((0, l6.forwardEvent)(this._bufferService.onResize, this._onResize)), this.register((0, l6.forwardEvent)(this.coreService.onData, this._onData)), this.register((0, l6.forwardEvent)(this.coreService.onBinary, this._onBinary)), this.register(this.coreService.onRequestScrollToBottom((() => this.scrollToBottom()))), this.register(this.coreService.onUserInput((() => this._writeBuffer.handleUserInput()))), this.register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], (() => this._handleWindowsPtyOptionChange()))), this.register(this._bufferService.onScroll(((e13) => {
              this._onScroll.fire({ position: this._bufferService.buffer.ydisp, source: 0 }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
            }))), this.register(this._inputHandler.onScroll(((e13) => {
              this._onScroll.fire({ position: this._bufferService.buffer.ydisp, source: 0 }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
            }))), this._writeBuffer = this.register(new p4.WriteBuffer(((e13, t8) => this._inputHandler.parse(e13, t8)))), this.register((0, l6.forwardEvent)(this._writeBuffer.onWriteParsed, this._onWriteParsed));
          }
          write(e12, t8) {
            this._writeBuffer.write(e12, t8);
          }
          writeSync(e12, t8) {
            this._logService.logLevel <= r11.LogLevelEnum.WARN && !m3 && (this._logService.warn("writeSync is unreliable and will be removed soon."), m3 = true), this._writeBuffer.writeSync(e12, t8);
          }
          resize(e12, t8) {
            isNaN(e12) || isNaN(t8) || (e12 = Math.max(e12, a4.MINIMUM_COLS), t8 = Math.max(t8, a4.MINIMUM_ROWS), this._bufferService.resize(e12, t8));
          }
          scroll(e12, t8 = false) {
            this._bufferService.scroll(e12, t8);
          }
          scrollLines(e12, t8, i10) {
            this._bufferService.scrollLines(e12, t8, i10);
          }
          scrollPages(e12) {
            this.scrollLines(e12 * (this.rows - 1));
          }
          scrollToTop() {
            this.scrollLines(-this._bufferService.buffer.ydisp);
          }
          scrollToBottom() {
            this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
          }
          scrollToLine(e12) {
            const t8 = e12 - this._bufferService.buffer.ydisp;
            0 !== t8 && this.scrollLines(t8);
          }
          registerEscHandler(e12, t8) {
            return this._inputHandler.registerEscHandler(e12, t8);
          }
          registerDcsHandler(e12, t8) {
            return this._inputHandler.registerDcsHandler(e12, t8);
          }
          registerCsiHandler(e12, t8) {
            return this._inputHandler.registerCsiHandler(e12, t8);
          }
          registerOscHandler(e12, t8) {
            return this._inputHandler.registerOscHandler(e12, t8);
          }
          _setup() {
            this._handleWindowsPtyOptionChange();
          }
          reset() {
            this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
          }
          _handleWindowsPtyOptionChange() {
            let e12 = false;
            const t8 = this.optionsService.rawOptions.windowsPty;
            t8 && void 0 !== t8.buildNumber && void 0 !== t8.buildNumber ? e12 = !!("conpty" === t8.backend && t8.buildNumber < 21376) : this.optionsService.rawOptions.windowsMode && (e12 = true), e12 ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
          }
          _enableWindowsWrappingHeuristics() {
            if (!this._windowsWrappingHeuristics.value) {
              const e12 = [];
              e12.push(this.onLineFeed(f3.updateWindowsModeWrappedState.bind(null, this._bufferService))), e12.push(this.registerCsiHandler({ final: "H" }, (() => ((0, f3.updateWindowsModeWrappedState)(this._bufferService), false)))), this._windowsWrappingHeuristics.value = (0, s5.toDisposable)((() => {
                for (const t8 of e12) t8.dispose();
              }));
            }
          }
        }
        t7.CoreTerminal = S3;
      }, 8460: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.forwardEvent = t7.EventEmitter = void 0, t7.EventEmitter = class {
          constructor() {
            this._listeners = [], this._disposed = false;
          }
          get event() {
            return this._event || (this._event = (e12) => (this._listeners.push(e12), { dispose: () => {
              if (!this._disposed) {
                for (let t8 = 0; t8 < this._listeners.length; t8++) if (this._listeners[t8] === e12) return void this._listeners.splice(t8, 1);
              }
            } })), this._event;
          }
          fire(e12, t8) {
            const i9 = [];
            for (let e13 = 0; e13 < this._listeners.length; e13++) i9.push(this._listeners[e13]);
            for (let s5 = 0; s5 < i9.length; s5++) i9[s5].call(void 0, e12, t8);
          }
          dispose() {
            this.clearListeners(), this._disposed = true;
          }
          clearListeners() {
            this._listeners && (this._listeners.length = 0);
          }
        }, t7.forwardEvent = function(e12, t8) {
          return e12(((e13) => t8.fire(e13)));
        };
      }, 5435: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.InputHandler = t7.WindowsOptionsReportType = void 0;
        const n6 = i9(2584), o10 = i9(7116), a4 = i9(2015), h4 = i9(844), c5 = i9(482), l6 = i9(8437), d3 = i9(8460), _3 = i9(643), u4 = i9(511), f3 = i9(3734), v2 = i9(2585), p4 = i9(6242), g2 = i9(6351), m3 = i9(5941), S3 = { "(": 0, ")": 1, "*": 2, "+": 3, "-": 1, ".": 2 }, C3 = 131072;
        function b3(e12, t8) {
          if (e12 > 24) return t8.setWinLines || false;
          switch (e12) {
            case 1:
              return !!t8.restoreWin;
            case 2:
              return !!t8.minimizeWin;
            case 3:
              return !!t8.setWinPosition;
            case 4:
              return !!t8.setWinSizePixels;
            case 5:
              return !!t8.raiseWin;
            case 6:
              return !!t8.lowerWin;
            case 7:
              return !!t8.refreshWin;
            case 8:
              return !!t8.setWinSizeChars;
            case 9:
              return !!t8.maximizeWin;
            case 10:
              return !!t8.fullscreenWin;
            case 11:
              return !!t8.getWinState;
            case 13:
              return !!t8.getWinPosition;
            case 14:
              return !!t8.getWinSizePixels;
            case 15:
              return !!t8.getScreenSizePixels;
            case 16:
              return !!t8.getCellSizePixels;
            case 18:
              return !!t8.getWinSizeChars;
            case 19:
              return !!t8.getScreenSizeChars;
            case 20:
              return !!t8.getIconTitle;
            case 21:
              return !!t8.getWinTitle;
            case 22:
              return !!t8.pushTitle;
            case 23:
              return !!t8.popTitle;
            case 24:
              return !!t8.setWinLines;
          }
          return false;
        }
        var y3;
        !(function(e12) {
          e12[e12.GET_WIN_SIZE_PIXELS = 0] = "GET_WIN_SIZE_PIXELS", e12[e12.GET_CELL_SIZE_PIXELS = 1] = "GET_CELL_SIZE_PIXELS";
        })(y3 || (t7.WindowsOptionsReportType = y3 = {}));
        let w2 = 0;
        class E2 extends h4.Disposable {
          getAttrData() {
            return this._curAttrData;
          }
          constructor(e12, t8, i10, s6, r12, h5, _4, f4, v3 = new a4.EscapeSequenceParser()) {
            super(), this._bufferService = e12, this._charsetService = t8, this._coreService = i10, this._logService = s6, this._optionsService = r12, this._oscLinkService = h5, this._coreMouseService = _4, this._unicodeService = f4, this._parser = v3, this._parseBuffer = new Uint32Array(4096), this._stringDecoder = new c5.StringToUtf32(), this._utf8Decoder = new c5.Utf8ToUtf32(), this._workCell = new u4.CellData(), this._windowTitle = "", this._iconName = "", this._windowTitleStack = [], this._iconNameStack = [], this._curAttrData = l6.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l6.DEFAULT_ATTR_DATA.clone(), this._onRequestBell = this.register(new d3.EventEmitter()), this.onRequestBell = this._onRequestBell.event, this._onRequestRefreshRows = this.register(new d3.EventEmitter()), this.onRequestRefreshRows = this._onRequestRefreshRows.event, this._onRequestReset = this.register(new d3.EventEmitter()), this.onRequestReset = this._onRequestReset.event, this._onRequestSendFocus = this.register(new d3.EventEmitter()), this.onRequestSendFocus = this._onRequestSendFocus.event, this._onRequestSyncScrollBar = this.register(new d3.EventEmitter()), this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event, this._onRequestWindowsOptionsReport = this.register(new d3.EventEmitter()), this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event, this._onA11yChar = this.register(new d3.EventEmitter()), this.onA11yChar = this._onA11yChar.event, this._onA11yTab = this.register(new d3.EventEmitter()), this.onA11yTab = this._onA11yTab.event, this._onCursorMove = this.register(new d3.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onLineFeed = this.register(new d3.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onScroll = this.register(new d3.EventEmitter()), this.onScroll = this._onScroll.event, this._onTitleChange = this.register(new d3.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onColor = this.register(new d3.EventEmitter()), this.onColor = this._onColor.event, this._parseStack = { paused: false, cursorStartX: 0, cursorStartY: 0, decodedLength: 0, position: 0 }, this._specialColors = [256, 257, 258], this.register(this._parser), this._dirtyRowTracker = new k3(this._bufferService), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate(((e13) => this._activeBuffer = e13.activeBuffer))), this._parser.setCsiHandlerFallback(((e13, t9) => {
              this._logService.debug("Unknown CSI code: ", { identifier: this._parser.identToString(e13), params: t9.toArray() });
            })), this._parser.setEscHandlerFallback(((e13) => {
              this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(e13) });
            })), this._parser.setExecuteHandlerFallback(((e13) => {
              this._logService.debug("Unknown EXECUTE code: ", { code: e13 });
            })), this._parser.setOscHandlerFallback(((e13, t9, i11) => {
              this._logService.debug("Unknown OSC code: ", { identifier: e13, action: t9, data: i11 });
            })), this._parser.setDcsHandlerFallback(((e13, t9, i11) => {
              "HOOK" === t9 && (i11 = i11.toArray()), this._logService.debug("Unknown DCS code: ", { identifier: this._parser.identToString(e13), action: t9, payload: i11 });
            })), this._parser.setPrintHandler(((e13, t9, i11) => this.print(e13, t9, i11))), this._parser.registerCsiHandler({ final: "@" }, ((e13) => this.insertChars(e13))), this._parser.registerCsiHandler({ intermediates: " ", final: "@" }, ((e13) => this.scrollLeft(e13))), this._parser.registerCsiHandler({ final: "A" }, ((e13) => this.cursorUp(e13))), this._parser.registerCsiHandler({ intermediates: " ", final: "A" }, ((e13) => this.scrollRight(e13))), this._parser.registerCsiHandler({ final: "B" }, ((e13) => this.cursorDown(e13))), this._parser.registerCsiHandler({ final: "C" }, ((e13) => this.cursorForward(e13))), this._parser.registerCsiHandler({ final: "D" }, ((e13) => this.cursorBackward(e13))), this._parser.registerCsiHandler({ final: "E" }, ((e13) => this.cursorNextLine(e13))), this._parser.registerCsiHandler({ final: "F" }, ((e13) => this.cursorPrecedingLine(e13))), this._parser.registerCsiHandler({ final: "G" }, ((e13) => this.cursorCharAbsolute(e13))), this._parser.registerCsiHandler({ final: "H" }, ((e13) => this.cursorPosition(e13))), this._parser.registerCsiHandler({ final: "I" }, ((e13) => this.cursorForwardTab(e13))), this._parser.registerCsiHandler({ final: "J" }, ((e13) => this.eraseInDisplay(e13, false))), this._parser.registerCsiHandler({ prefix: "?", final: "J" }, ((e13) => this.eraseInDisplay(e13, true))), this._parser.registerCsiHandler({ final: "K" }, ((e13) => this.eraseInLine(e13, false))), this._parser.registerCsiHandler({ prefix: "?", final: "K" }, ((e13) => this.eraseInLine(e13, true))), this._parser.registerCsiHandler({ final: "L" }, ((e13) => this.insertLines(e13))), this._parser.registerCsiHandler({ final: "M" }, ((e13) => this.deleteLines(e13))), this._parser.registerCsiHandler({ final: "P" }, ((e13) => this.deleteChars(e13))), this._parser.registerCsiHandler({ final: "S" }, ((e13) => this.scrollUp(e13))), this._parser.registerCsiHandler({ final: "T" }, ((e13) => this.scrollDown(e13))), this._parser.registerCsiHandler({ final: "X" }, ((e13) => this.eraseChars(e13))), this._parser.registerCsiHandler({ final: "Z" }, ((e13) => this.cursorBackwardTab(e13))), this._parser.registerCsiHandler({ final: "`" }, ((e13) => this.charPosAbsolute(e13))), this._parser.registerCsiHandler({ final: "a" }, ((e13) => this.hPositionRelative(e13))), this._parser.registerCsiHandler({ final: "b" }, ((e13) => this.repeatPrecedingCharacter(e13))), this._parser.registerCsiHandler({ final: "c" }, ((e13) => this.sendDeviceAttributesPrimary(e13))), this._parser.registerCsiHandler({ prefix: ">", final: "c" }, ((e13) => this.sendDeviceAttributesSecondary(e13))), this._parser.registerCsiHandler({ final: "d" }, ((e13) => this.linePosAbsolute(e13))), this._parser.registerCsiHandler({ final: "e" }, ((e13) => this.vPositionRelative(e13))), this._parser.registerCsiHandler({ final: "f" }, ((e13) => this.hVPosition(e13))), this._parser.registerCsiHandler({ final: "g" }, ((e13) => this.tabClear(e13))), this._parser.registerCsiHandler({ final: "h" }, ((e13) => this.setMode(e13))), this._parser.registerCsiHandler({ prefix: "?", final: "h" }, ((e13) => this.setModePrivate(e13))), this._parser.registerCsiHandler({ final: "l" }, ((e13) => this.resetMode(e13))), this._parser.registerCsiHandler({ prefix: "?", final: "l" }, ((e13) => this.resetModePrivate(e13))), this._parser.registerCsiHandler({ final: "m" }, ((e13) => this.charAttributes(e13))), this._parser.registerCsiHandler({ final: "n" }, ((e13) => this.deviceStatus(e13))), this._parser.registerCsiHandler({ prefix: "?", final: "n" }, ((e13) => this.deviceStatusPrivate(e13))), this._parser.registerCsiHandler({ intermediates: "!", final: "p" }, ((e13) => this.softReset(e13))), this._parser.registerCsiHandler({ intermediates: " ", final: "q" }, ((e13) => this.setCursorStyle(e13))), this._parser.registerCsiHandler({ final: "r" }, ((e13) => this.setScrollRegion(e13))), this._parser.registerCsiHandler({ final: "s" }, ((e13) => this.saveCursor(e13))), this._parser.registerCsiHandler({ final: "t" }, ((e13) => this.windowOptions(e13))), this._parser.registerCsiHandler({ final: "u" }, ((e13) => this.restoreCursor(e13))), this._parser.registerCsiHandler({ intermediates: "'", final: "}" }, ((e13) => this.insertColumns(e13))), this._parser.registerCsiHandler({ intermediates: "'", final: "~" }, ((e13) => this.deleteColumns(e13))), this._parser.registerCsiHandler({ intermediates: '"', final: "q" }, ((e13) => this.selectProtected(e13))), this._parser.registerCsiHandler({ intermediates: "$", final: "p" }, ((e13) => this.requestMode(e13, true))), this._parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, ((e13) => this.requestMode(e13, false))), this._parser.setExecuteHandler(n6.C0.BEL, (() => this.bell())), this._parser.setExecuteHandler(n6.C0.LF, (() => this.lineFeed())), this._parser.setExecuteHandler(n6.C0.VT, (() => this.lineFeed())), this._parser.setExecuteHandler(n6.C0.FF, (() => this.lineFeed())), this._parser.setExecuteHandler(n6.C0.CR, (() => this.carriageReturn())), this._parser.setExecuteHandler(n6.C0.BS, (() => this.backspace())), this._parser.setExecuteHandler(n6.C0.HT, (() => this.tab())), this._parser.setExecuteHandler(n6.C0.SO, (() => this.shiftOut())), this._parser.setExecuteHandler(n6.C0.SI, (() => this.shiftIn())), this._parser.setExecuteHandler(n6.C1.IND, (() => this.index())), this._parser.setExecuteHandler(n6.C1.NEL, (() => this.nextLine())), this._parser.setExecuteHandler(n6.C1.HTS, (() => this.tabSet())), this._parser.registerOscHandler(0, new p4.OscHandler(((e13) => (this.setTitle(e13), this.setIconName(e13), true)))), this._parser.registerOscHandler(1, new p4.OscHandler(((e13) => this.setIconName(e13)))), this._parser.registerOscHandler(2, new p4.OscHandler(((e13) => this.setTitle(e13)))), this._parser.registerOscHandler(4, new p4.OscHandler(((e13) => this.setOrReportIndexedColor(e13)))), this._parser.registerOscHandler(8, new p4.OscHandler(((e13) => this.setHyperlink(e13)))), this._parser.registerOscHandler(10, new p4.OscHandler(((e13) => this.setOrReportFgColor(e13)))), this._parser.registerOscHandler(11, new p4.OscHandler(((e13) => this.setOrReportBgColor(e13)))), this._parser.registerOscHandler(12, new p4.OscHandler(((e13) => this.setOrReportCursorColor(e13)))), this._parser.registerOscHandler(104, new p4.OscHandler(((e13) => this.restoreIndexedColor(e13)))), this._parser.registerOscHandler(110, new p4.OscHandler(((e13) => this.restoreFgColor(e13)))), this._parser.registerOscHandler(111, new p4.OscHandler(((e13) => this.restoreBgColor(e13)))), this._parser.registerOscHandler(112, new p4.OscHandler(((e13) => this.restoreCursorColor(e13)))), this._parser.registerEscHandler({ final: "7" }, (() => this.saveCursor())), this._parser.registerEscHandler({ final: "8" }, (() => this.restoreCursor())), this._parser.registerEscHandler({ final: "D" }, (() => this.index())), this._parser.registerEscHandler({ final: "E" }, (() => this.nextLine())), this._parser.registerEscHandler({ final: "H" }, (() => this.tabSet())), this._parser.registerEscHandler({ final: "M" }, (() => this.reverseIndex())), this._parser.registerEscHandler({ final: "=" }, (() => this.keypadApplicationMode())), this._parser.registerEscHandler({ final: ">" }, (() => this.keypadNumericMode())), this._parser.registerEscHandler({ final: "c" }, (() => this.fullReset())), this._parser.registerEscHandler({ final: "n" }, (() => this.setgLevel(2))), this._parser.registerEscHandler({ final: "o" }, (() => this.setgLevel(3))), this._parser.registerEscHandler({ final: "|" }, (() => this.setgLevel(3))), this._parser.registerEscHandler({ final: "}" }, (() => this.setgLevel(2))), this._parser.registerEscHandler({ final: "~" }, (() => this.setgLevel(1))), this._parser.registerEscHandler({ intermediates: "%", final: "@" }, (() => this.selectDefaultCharset())), this._parser.registerEscHandler({ intermediates: "%", final: "G" }, (() => this.selectDefaultCharset()));
            for (const e13 in o10.CHARSETS) this._parser.registerEscHandler({ intermediates: "(", final: e13 }, (() => this.selectCharset("(" + e13))), this._parser.registerEscHandler({ intermediates: ")", final: e13 }, (() => this.selectCharset(")" + e13))), this._parser.registerEscHandler({ intermediates: "*", final: e13 }, (() => this.selectCharset("*" + e13))), this._parser.registerEscHandler({ intermediates: "+", final: e13 }, (() => this.selectCharset("+" + e13))), this._parser.registerEscHandler({ intermediates: "-", final: e13 }, (() => this.selectCharset("-" + e13))), this._parser.registerEscHandler({ intermediates: ".", final: e13 }, (() => this.selectCharset("." + e13))), this._parser.registerEscHandler({ intermediates: "/", final: e13 }, (() => this.selectCharset("/" + e13)));
            this._parser.registerEscHandler({ intermediates: "#", final: "8" }, (() => this.screenAlignmentPattern())), this._parser.setErrorHandler(((e13) => (this._logService.error("Parsing error: ", e13), e13))), this._parser.registerDcsHandler({ intermediates: "$", final: "q" }, new g2.DcsHandler(((e13, t9) => this.requestStatusString(e13, t9))));
          }
          _preserveStack(e12, t8, i10, s6) {
            this._parseStack.paused = true, this._parseStack.cursorStartX = e12, this._parseStack.cursorStartY = t8, this._parseStack.decodedLength = i10, this._parseStack.position = s6;
          }
          _logSlowResolvingAsync(e12) {
            this._logService.logLevel <= v2.LogLevelEnum.WARN && Promise.race([e12, new Promise(((e13, t8) => setTimeout((() => t8("#SLOW_TIMEOUT")), 5e3)))]).catch(((e13) => {
              if ("#SLOW_TIMEOUT" !== e13) throw e13;
              console.warn("async parser handler taking longer than 5000 ms");
            }));
          }
          _getCurrentLinkId() {
            return this._curAttrData.extended.urlId;
          }
          parse(e12, t8) {
            let i10, s6 = this._activeBuffer.x, r12 = this._activeBuffer.y, n7 = 0;
            const o11 = this._parseStack.paused;
            if (o11) {
              if (i10 = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, t8)) return this._logSlowResolvingAsync(i10), i10;
              s6 = this._parseStack.cursorStartX, r12 = this._parseStack.cursorStartY, this._parseStack.paused = false, e12.length > C3 && (n7 = this._parseStack.position + C3);
            }
            if (this._logService.logLevel <= v2.LogLevelEnum.DEBUG && this._logService.debug("parsing data" + ("string" == typeof e12 ? ` "${e12}"` : ` "${Array.prototype.map.call(e12, ((e13) => String.fromCharCode(e13))).join("")}"`), "string" == typeof e12 ? e12.split("").map(((e13) => e13.charCodeAt(0))) : e12), this._parseBuffer.length < e12.length && this._parseBuffer.length < C3 && (this._parseBuffer = new Uint32Array(Math.min(e12.length, C3))), o11 || this._dirtyRowTracker.clearRange(), e12.length > C3) for (let t9 = n7; t9 < e12.length; t9 += C3) {
              const n8 = t9 + C3 < e12.length ? t9 + C3 : e12.length, o12 = "string" == typeof e12 ? this._stringDecoder.decode(e12.substring(t9, n8), this._parseBuffer) : this._utf8Decoder.decode(e12.subarray(t9, n8), this._parseBuffer);
              if (i10 = this._parser.parse(this._parseBuffer, o12)) return this._preserveStack(s6, r12, o12, t9), this._logSlowResolvingAsync(i10), i10;
            }
            else if (!o11) {
              const t9 = "string" == typeof e12 ? this._stringDecoder.decode(e12, this._parseBuffer) : this._utf8Decoder.decode(e12, this._parseBuffer);
              if (i10 = this._parser.parse(this._parseBuffer, t9)) return this._preserveStack(s6, r12, t9, 0), this._logSlowResolvingAsync(i10), i10;
            }
            this._activeBuffer.x === s6 && this._activeBuffer.y === r12 || this._onCursorMove.fire(), this._onRequestRefreshRows.fire(this._dirtyRowTracker.start, this._dirtyRowTracker.end);
          }
          print(e12, t8, i10) {
            let s6, r12;
            const n7 = this._charsetService.charset, o11 = this._optionsService.rawOptions.screenReaderMode, a5 = this._bufferService.cols, h5 = this._coreService.decPrivateModes.wraparound, l7 = this._coreService.modes.insertMode, d4 = this._curAttrData;
            let u5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && i10 - t8 > 0 && 2 === u5.getWidth(this._activeBuffer.x - 1) && u5.setCellFromCodePoint(this._activeBuffer.x - 1, 0, 1, d4.fg, d4.bg, d4.extended);
            for (let f4 = t8; f4 < i10; ++f4) {
              if (s6 = e12[f4], r12 = this._unicodeService.wcwidth(s6), s6 < 127 && n7) {
                const e13 = n7[String.fromCharCode(s6)];
                e13 && (s6 = e13.charCodeAt(0));
              }
              if (o11 && this._onA11yChar.fire((0, c5.stringFromCodePoint)(s6)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), r12 || !this._activeBuffer.x) {
                if (this._activeBuffer.x + r12 - 1 >= a5) {
                  if (h5) {
                    for (; this._activeBuffer.x < a5; ) u5.setCellFromCodePoint(this._activeBuffer.x++, 0, 1, d4.fg, d4.bg, d4.extended);
                    this._activeBuffer.x = 0, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), true)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = true), u5 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
                  } else if (this._activeBuffer.x = a5 - 1, 2 === r12) continue;
                }
                if (l7 && (u5.insertCells(this._activeBuffer.x, r12, this._activeBuffer.getNullCell(d4), d4), 2 === u5.getWidth(a5 - 1) && u5.setCellFromCodePoint(a5 - 1, _3.NULL_CELL_CODE, _3.NULL_CELL_WIDTH, d4.fg, d4.bg, d4.extended)), u5.setCellFromCodePoint(this._activeBuffer.x++, s6, r12, d4.fg, d4.bg, d4.extended), r12 > 0) for (; --r12; ) u5.setCellFromCodePoint(this._activeBuffer.x++, 0, 0, d4.fg, d4.bg, d4.extended);
              } else u5.getWidth(this._activeBuffer.x - 1) ? u5.addCodepointToCell(this._activeBuffer.x - 1, s6) : u5.addCodepointToCell(this._activeBuffer.x - 2, s6);
            }
            i10 - t8 > 0 && (u5.loadCell(this._activeBuffer.x - 1, this._workCell), 2 === this._workCell.getWidth() || this._workCell.getCode() > 65535 ? this._parser.precedingCodepoint = 0 : this._workCell.isCombined() ? this._parser.precedingCodepoint = this._workCell.getChars().charCodeAt(0) : this._parser.precedingCodepoint = this._workCell.content), this._activeBuffer.x < a5 && i10 - t8 > 0 && 0 === u5.getWidth(this._activeBuffer.x) && !u5.hasContent(this._activeBuffer.x) && u5.setCellFromCodePoint(this._activeBuffer.x, 0, 1, d4.fg, d4.bg, d4.extended), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          registerCsiHandler(e12, t8) {
            return "t" !== e12.final || e12.prefix || e12.intermediates ? this._parser.registerCsiHandler(e12, t8) : this._parser.registerCsiHandler(e12, ((e13) => !b3(e13.params[0], this._optionsService.rawOptions.windowOptions) || t8(e13)));
          }
          registerDcsHandler(e12, t8) {
            return this._parser.registerDcsHandler(e12, new g2.DcsHandler(t8));
          }
          registerEscHandler(e12, t8) {
            return this._parser.registerEscHandler(e12, t8);
          }
          registerOscHandler(e12, t8) {
            return this._parser.registerOscHandler(e12, new p4.OscHandler(t8));
          }
          bell() {
            return this._onRequestBell.fire(), true;
          }
          lineFeed() {
            return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), true;
          }
          carriageReturn() {
            return this._activeBuffer.x = 0, true;
          }
          backspace() {
            var e12;
            if (!this._coreService.decPrivateModes.reverseWraparound) return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, true;
            if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0) this._activeBuffer.x--;
            else if (0 === this._activeBuffer.x && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && (null === (e12 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)) || void 0 === e12 ? void 0 : e12.isWrapped)) {
              this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
              const e13 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
              e13.hasWidth(this._activeBuffer.x) && !e13.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
            }
            return this._restrictCursor(), true;
          }
          tab() {
            if (this._activeBuffer.x >= this._bufferService.cols) return true;
            const e12 = this._activeBuffer.x;
            return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e12), true;
          }
          shiftOut() {
            return this._charsetService.setgLevel(1), true;
          }
          shiftIn() {
            return this._charsetService.setgLevel(0), true;
          }
          _restrictCursor(e12 = this._bufferService.cols - 1) {
            this._activeBuffer.x = Math.min(e12, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          _setCursor(e12, t8) {
            this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e12, this._activeBuffer.y = this._activeBuffer.scrollTop + t8) : (this._activeBuffer.x = e12, this._activeBuffer.y = t8), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
          }
          _moveCursor(e12, t8) {
            this._restrictCursor(), this._setCursor(this._activeBuffer.x + e12, this._activeBuffer.y + t8);
          }
          cursorUp(e12) {
            const t8 = this._activeBuffer.y - this._activeBuffer.scrollTop;
            return t8 >= 0 ? this._moveCursor(0, -Math.min(t8, e12.params[0] || 1)) : this._moveCursor(0, -(e12.params[0] || 1)), true;
          }
          cursorDown(e12) {
            const t8 = this._activeBuffer.scrollBottom - this._activeBuffer.y;
            return t8 >= 0 ? this._moveCursor(0, Math.min(t8, e12.params[0] || 1)) : this._moveCursor(0, e12.params[0] || 1), true;
          }
          cursorForward(e12) {
            return this._moveCursor(e12.params[0] || 1, 0), true;
          }
          cursorBackward(e12) {
            return this._moveCursor(-(e12.params[0] || 1), 0), true;
          }
          cursorNextLine(e12) {
            return this.cursorDown(e12), this._activeBuffer.x = 0, true;
          }
          cursorPrecedingLine(e12) {
            return this.cursorUp(e12), this._activeBuffer.x = 0, true;
          }
          cursorCharAbsolute(e12) {
            return this._setCursor((e12.params[0] || 1) - 1, this._activeBuffer.y), true;
          }
          cursorPosition(e12) {
            return this._setCursor(e12.length >= 2 ? (e12.params[1] || 1) - 1 : 0, (e12.params[0] || 1) - 1), true;
          }
          charPosAbsolute(e12) {
            return this._setCursor((e12.params[0] || 1) - 1, this._activeBuffer.y), true;
          }
          hPositionRelative(e12) {
            return this._moveCursor(e12.params[0] || 1, 0), true;
          }
          linePosAbsolute(e12) {
            return this._setCursor(this._activeBuffer.x, (e12.params[0] || 1) - 1), true;
          }
          vPositionRelative(e12) {
            return this._moveCursor(0, e12.params[0] || 1), true;
          }
          hVPosition(e12) {
            return this.cursorPosition(e12), true;
          }
          tabClear(e12) {
            const t8 = e12.params[0];
            return 0 === t8 ? delete this._activeBuffer.tabs[this._activeBuffer.x] : 3 === t8 && (this._activeBuffer.tabs = {}), true;
          }
          cursorForwardTab(e12) {
            if (this._activeBuffer.x >= this._bufferService.cols) return true;
            let t8 = e12.params[0] || 1;
            for (; t8--; ) this._activeBuffer.x = this._activeBuffer.nextStop();
            return true;
          }
          cursorBackwardTab(e12) {
            if (this._activeBuffer.x >= this._bufferService.cols) return true;
            let t8 = e12.params[0] || 1;
            for (; t8--; ) this._activeBuffer.x = this._activeBuffer.prevStop();
            return true;
          }
          selectProtected(e12) {
            const t8 = e12.params[0];
            return 1 === t8 && (this._curAttrData.bg |= 536870912), 2 !== t8 && 0 !== t8 || (this._curAttrData.bg &= -536870913), true;
          }
          _eraseInBufferLine(e12, t8, i10, s6 = false, r12 = false) {
            const n7 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e12);
            n7.replaceCells(t8, i10, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData(), r12), s6 && (n7.isWrapped = false);
          }
          _resetBufferLine(e12, t8 = false) {
            const i10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e12);
            i10 && (i10.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), t8), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e12), i10.isWrapped = false);
          }
          eraseInDisplay(e12, t8 = false) {
            let i10;
            switch (this._restrictCursor(this._bufferService.cols), e12.params[0]) {
              case 0:
                for (i10 = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i10), this._eraseInBufferLine(i10++, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t8); i10 < this._bufferService.rows; i10++) this._resetBufferLine(i10, t8);
                this._dirtyRowTracker.markDirty(i10);
                break;
              case 1:
                for (i10 = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i10), this._eraseInBufferLine(i10, 0, this._activeBuffer.x + 1, true, t8), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(i10 + 1).isWrapped = false); i10--; ) this._resetBufferLine(i10, t8);
                this._dirtyRowTracker.markDirty(0);
                break;
              case 2:
                for (i10 = this._bufferService.rows, this._dirtyRowTracker.markDirty(i10 - 1); i10--; ) this._resetBufferLine(i10, t8);
                this._dirtyRowTracker.markDirty(0);
                break;
              case 3:
                const e13 = this._activeBuffer.lines.length - this._bufferService.rows;
                e13 > 0 && (this._activeBuffer.lines.trimStart(e13), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - e13, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - e13, 0), this._onScroll.fire(0));
            }
            return true;
          }
          eraseInLine(e12, t8 = false) {
            switch (this._restrictCursor(this._bufferService.cols), e12.params[0]) {
              case 0:
                this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t8);
                break;
              case 1:
                this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, false, t8);
                break;
              case 2:
                this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, true, t8);
            }
            return this._dirtyRowTracker.markDirty(this._activeBuffer.y), true;
          }
          insertLines(e12) {
            this._restrictCursor();
            let t8 = e12.params[0] || 1;
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const i10 = this._activeBuffer.ybase + this._activeBuffer.y, s6 = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, r12 = this._bufferService.rows - 1 + this._activeBuffer.ybase - s6 + 1;
            for (; t8--; ) this._activeBuffer.lines.splice(r12 - 1, 1), this._activeBuffer.lines.splice(i10, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
          }
          deleteLines(e12) {
            this._restrictCursor();
            let t8 = e12.params[0] || 1;
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const i10 = this._activeBuffer.ybase + this._activeBuffer.y;
            let s6;
            for (s6 = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, s6 = this._bufferService.rows - 1 + this._activeBuffer.ybase - s6; t8--; ) this._activeBuffer.lines.splice(i10, 1), this._activeBuffer.lines.splice(s6, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
          }
          insertChars(e12) {
            this._restrictCursor();
            const t8 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t8 && (t8.insertCells(this._activeBuffer.x, e12.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          deleteChars(e12) {
            this._restrictCursor();
            const t8 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t8 && (t8.deleteCells(this._activeBuffer.x, e12.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          scrollUp(e12) {
            let t8 = e12.params[0] || 1;
            for (; t8--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollDown(e12) {
            let t8 = e12.params[0] || 1;
            for (; t8--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(l6.DEFAULT_ATTR_DATA));
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollLeft(e12) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t8 = e12.params[0] || 1;
            for (let e13 = this._activeBuffer.scrollTop; e13 <= this._activeBuffer.scrollBottom; ++e13) {
              const i10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e13);
              i10.deleteCells(0, t8, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i10.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          scrollRight(e12) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t8 = e12.params[0] || 1;
            for (let e13 = this._activeBuffer.scrollTop; e13 <= this._activeBuffer.scrollBottom; ++e13) {
              const i10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e13);
              i10.insertCells(0, t8, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i10.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          insertColumns(e12) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t8 = e12.params[0] || 1;
            for (let e13 = this._activeBuffer.scrollTop; e13 <= this._activeBuffer.scrollBottom; ++e13) {
              const i10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e13);
              i10.insertCells(this._activeBuffer.x, t8, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i10.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          deleteColumns(e12) {
            if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
            const t8 = e12.params[0] || 1;
            for (let e13 = this._activeBuffer.scrollTop; e13 <= this._activeBuffer.scrollBottom; ++e13) {
              const i10 = this._activeBuffer.lines.get(this._activeBuffer.ybase + e13);
              i10.deleteCells(this._activeBuffer.x, t8, this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), i10.isWrapped = false;
            }
            return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
          }
          eraseChars(e12) {
            this._restrictCursor();
            const t8 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
            return t8 && (t8.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e12.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData()), this._eraseAttrData()), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
          }
          repeatPrecedingCharacter(e12) {
            if (!this._parser.precedingCodepoint) return true;
            const t8 = e12.params[0] || 1, i10 = new Uint32Array(t8);
            for (let e13 = 0; e13 < t8; ++e13) i10[e13] = this._parser.precedingCodepoint;
            return this.print(i10, 0, i10.length), true;
          }
          sendDeviceAttributesPrimary(e12) {
            return e12.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(n6.C0.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(n6.C0.ESC + "[?6c")), true;
          }
          sendDeviceAttributesSecondary(e12) {
            return e12.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(n6.C0.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(n6.C0.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e12.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(n6.C0.ESC + "[>83;40003;0c")), true;
          }
          _is(e12) {
            return 0 === (this._optionsService.rawOptions.termName + "").indexOf(e12);
          }
          setMode(e12) {
            for (let t8 = 0; t8 < e12.length; t8++) switch (e12.params[t8]) {
              case 4:
                this._coreService.modes.insertMode = true;
                break;
              case 20:
                this._optionsService.options.convertEol = true;
            }
            return true;
          }
          setModePrivate(e12) {
            for (let t8 = 0; t8 < e12.length; t8++) switch (e12.params[t8]) {
              case 1:
                this._coreService.decPrivateModes.applicationCursorKeys = true;
                break;
              case 2:
                this._charsetService.setgCharset(0, o10.DEFAULT_CHARSET), this._charsetService.setgCharset(1, o10.DEFAULT_CHARSET), this._charsetService.setgCharset(2, o10.DEFAULT_CHARSET), this._charsetService.setgCharset(3, o10.DEFAULT_CHARSET);
                break;
              case 3:
                this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
                break;
              case 6:
                this._coreService.decPrivateModes.origin = true, this._setCursor(0, 0);
                break;
              case 7:
                this._coreService.decPrivateModes.wraparound = true;
                break;
              case 12:
                this._optionsService.options.cursorBlink = true;
                break;
              case 45:
                this._coreService.decPrivateModes.reverseWraparound = true;
                break;
              case 66:
                this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire();
                break;
              case 9:
                this._coreMouseService.activeProtocol = "X10";
                break;
              case 1e3:
                this._coreMouseService.activeProtocol = "VT200";
                break;
              case 1002:
                this._coreMouseService.activeProtocol = "DRAG";
                break;
              case 1003:
                this._coreMouseService.activeProtocol = "ANY";
                break;
              case 1004:
                this._coreService.decPrivateModes.sendFocus = true, this._onRequestSendFocus.fire();
                break;
              case 1005:
                this._logService.debug("DECSET 1005 not supported (see #2507)");
                break;
              case 1006:
                this._coreMouseService.activeEncoding = "SGR";
                break;
              case 1015:
                this._logService.debug("DECSET 1015 not supported (see #2507)");
                break;
              case 1016:
                this._coreMouseService.activeEncoding = "SGR_PIXELS";
                break;
              case 25:
                this._coreService.isCursorHidden = false;
                break;
              case 1048:
                this.saveCursor();
                break;
              case 1049:
                this.saveCursor();
              case 47:
              case 1047:
                this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
                break;
              case 2004:
                this._coreService.decPrivateModes.bracketedPasteMode = true;
            }
            return true;
          }
          resetMode(e12) {
            for (let t8 = 0; t8 < e12.length; t8++) switch (e12.params[t8]) {
              case 4:
                this._coreService.modes.insertMode = false;
                break;
              case 20:
                this._optionsService.options.convertEol = false;
            }
            return true;
          }
          resetModePrivate(e12) {
            for (let t8 = 0; t8 < e12.length; t8++) switch (e12.params[t8]) {
              case 1:
                this._coreService.decPrivateModes.applicationCursorKeys = false;
                break;
              case 3:
                this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
                break;
              case 6:
                this._coreService.decPrivateModes.origin = false, this._setCursor(0, 0);
                break;
              case 7:
                this._coreService.decPrivateModes.wraparound = false;
                break;
              case 12:
                this._optionsService.options.cursorBlink = false;
                break;
              case 45:
                this._coreService.decPrivateModes.reverseWraparound = false;
                break;
              case 66:
                this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire();
                break;
              case 9:
              case 1e3:
              case 1002:
              case 1003:
                this._coreMouseService.activeProtocol = "NONE";
                break;
              case 1004:
                this._coreService.decPrivateModes.sendFocus = false;
                break;
              case 1005:
                this._logService.debug("DECRST 1005 not supported (see #2507)");
                break;
              case 1006:
              case 1016:
                this._coreMouseService.activeEncoding = "DEFAULT";
                break;
              case 1015:
                this._logService.debug("DECRST 1015 not supported (see #2507)");
                break;
              case 25:
                this._coreService.isCursorHidden = true;
                break;
              case 1048:
                this.restoreCursor();
                break;
              case 1049:
              case 47:
              case 1047:
                this._bufferService.buffers.activateNormalBuffer(), 1049 === e12.params[t8] && this.restoreCursor(), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
                break;
              case 2004:
                this._coreService.decPrivateModes.bracketedPasteMode = false;
            }
            return true;
          }
          requestMode(e12, t8) {
            const i10 = this._coreService.decPrivateModes, { activeProtocol: s6, activeEncoding: r12 } = this._coreMouseService, o11 = this._coreService, { buffers: a5, cols: h5 } = this._bufferService, { active: c6, alt: l7 } = a5, d4 = this._optionsService.rawOptions, _4 = (e13) => e13 ? 1 : 2, u5 = e12.params[0];
            return f4 = u5, v3 = t8 ? 2 === u5 ? 4 : 4 === u5 ? _4(o11.modes.insertMode) : 12 === u5 ? 3 : 20 === u5 ? _4(d4.convertEol) : 0 : 1 === u5 ? _4(i10.applicationCursorKeys) : 3 === u5 ? d4.windowOptions.setWinLines ? 80 === h5 ? 2 : 132 === h5 ? 1 : 0 : 0 : 6 === u5 ? _4(i10.origin) : 7 === u5 ? _4(i10.wraparound) : 8 === u5 ? 3 : 9 === u5 ? _4("X10" === s6) : 12 === u5 ? _4(d4.cursorBlink) : 25 === u5 ? _4(!o11.isCursorHidden) : 45 === u5 ? _4(i10.reverseWraparound) : 66 === u5 ? _4(i10.applicationKeypad) : 67 === u5 ? 4 : 1e3 === u5 ? _4("VT200" === s6) : 1002 === u5 ? _4("DRAG" === s6) : 1003 === u5 ? _4("ANY" === s6) : 1004 === u5 ? _4(i10.sendFocus) : 1005 === u5 ? 4 : 1006 === u5 ? _4("SGR" === r12) : 1015 === u5 ? 4 : 1016 === u5 ? _4("SGR_PIXELS" === r12) : 1048 === u5 ? 1 : 47 === u5 || 1047 === u5 || 1049 === u5 ? _4(c6 === l7) : 2004 === u5 ? _4(i10.bracketedPasteMode) : 0, o11.triggerDataEvent(`${n6.C0.ESC}[${t8 ? "" : "?"}${f4};${v3}$y`), true;
            var f4, v3;
          }
          _updateAttrColor(e12, t8, i10, s6, r12) {
            return 2 === t8 ? (e12 |= 50331648, e12 &= -16777216, e12 |= f3.AttributeData.fromColorRGB([i10, s6, r12])) : 5 === t8 && (e12 &= -50331904, e12 |= 33554432 | 255 & i10), e12;
          }
          _extractColor(e12, t8, i10) {
            const s6 = [0, 0, -1, 0, 0, 0];
            let r12 = 0, n7 = 0;
            do {
              if (s6[n7 + r12] = e12.params[t8 + n7], e12.hasSubParams(t8 + n7)) {
                const i11 = e12.getSubParams(t8 + n7);
                let o11 = 0;
                do {
                  5 === s6[1] && (r12 = 1), s6[n7 + o11 + 1 + r12] = i11[o11];
                } while (++o11 < i11.length && o11 + n7 + 1 + r12 < s6.length);
                break;
              }
              if (5 === s6[1] && n7 + r12 >= 2 || 2 === s6[1] && n7 + r12 >= 5) break;
              s6[1] && (r12 = 1);
            } while (++n7 + t8 < e12.length && n7 + r12 < s6.length);
            for (let e13 = 2; e13 < s6.length; ++e13) -1 === s6[e13] && (s6[e13] = 0);
            switch (s6[0]) {
              case 38:
                i10.fg = this._updateAttrColor(i10.fg, s6[1], s6[3], s6[4], s6[5]);
                break;
              case 48:
                i10.bg = this._updateAttrColor(i10.bg, s6[1], s6[3], s6[4], s6[5]);
                break;
              case 58:
                i10.extended = i10.extended.clone(), i10.extended.underlineColor = this._updateAttrColor(i10.extended.underlineColor, s6[1], s6[3], s6[4], s6[5]);
            }
            return n7;
          }
          _processUnderline(e12, t8) {
            t8.extended = t8.extended.clone(), (!~e12 || e12 > 5) && (e12 = 1), t8.extended.underlineStyle = e12, t8.fg |= 268435456, 0 === e12 && (t8.fg &= -268435457), t8.updateExtended();
          }
          _processSGR0(e12) {
            e12.fg = l6.DEFAULT_ATTR_DATA.fg, e12.bg = l6.DEFAULT_ATTR_DATA.bg, e12.extended = e12.extended.clone(), e12.extended.underlineStyle = 0, e12.extended.underlineColor &= -67108864, e12.updateExtended();
          }
          charAttributes(e12) {
            if (1 === e12.length && 0 === e12.params[0]) return this._processSGR0(this._curAttrData), true;
            const t8 = e12.length;
            let i10;
            const s6 = this._curAttrData;
            for (let r12 = 0; r12 < t8; r12++) i10 = e12.params[r12], i10 >= 30 && i10 <= 37 ? (s6.fg &= -50331904, s6.fg |= 16777216 | i10 - 30) : i10 >= 40 && i10 <= 47 ? (s6.bg &= -50331904, s6.bg |= 16777216 | i10 - 40) : i10 >= 90 && i10 <= 97 ? (s6.fg &= -50331904, s6.fg |= 16777224 | i10 - 90) : i10 >= 100 && i10 <= 107 ? (s6.bg &= -50331904, s6.bg |= 16777224 | i10 - 100) : 0 === i10 ? this._processSGR0(s6) : 1 === i10 ? s6.fg |= 134217728 : 3 === i10 ? s6.bg |= 67108864 : 4 === i10 ? (s6.fg |= 268435456, this._processUnderline(e12.hasSubParams(r12) ? e12.getSubParams(r12)[0] : 1, s6)) : 5 === i10 ? s6.fg |= 536870912 : 7 === i10 ? s6.fg |= 67108864 : 8 === i10 ? s6.fg |= 1073741824 : 9 === i10 ? s6.fg |= 2147483648 : 2 === i10 ? s6.bg |= 134217728 : 21 === i10 ? this._processUnderline(2, s6) : 22 === i10 ? (s6.fg &= -134217729, s6.bg &= -134217729) : 23 === i10 ? s6.bg &= -67108865 : 24 === i10 ? (s6.fg &= -268435457, this._processUnderline(0, s6)) : 25 === i10 ? s6.fg &= -536870913 : 27 === i10 ? s6.fg &= -67108865 : 28 === i10 ? s6.fg &= -1073741825 : 29 === i10 ? s6.fg &= 2147483647 : 39 === i10 ? (s6.fg &= -67108864, s6.fg |= 16777215 & l6.DEFAULT_ATTR_DATA.fg) : 49 === i10 ? (s6.bg &= -67108864, s6.bg |= 16777215 & l6.DEFAULT_ATTR_DATA.bg) : 38 === i10 || 48 === i10 || 58 === i10 ? r12 += this._extractColor(e12, r12, s6) : 53 === i10 ? s6.bg |= 1073741824 : 55 === i10 ? s6.bg &= -1073741825 : 59 === i10 ? (s6.extended = s6.extended.clone(), s6.extended.underlineColor = -1, s6.updateExtended()) : 100 === i10 ? (s6.fg &= -67108864, s6.fg |= 16777215 & l6.DEFAULT_ATTR_DATA.fg, s6.bg &= -67108864, s6.bg |= 16777215 & l6.DEFAULT_ATTR_DATA.bg) : this._logService.debug("Unknown SGR attribute: %d.", i10);
            return true;
          }
          deviceStatus(e12) {
            switch (e12.params[0]) {
              case 5:
                this._coreService.triggerDataEvent(`${n6.C0.ESC}[0n`);
                break;
              case 6:
                const e13 = this._activeBuffer.y + 1, t8 = this._activeBuffer.x + 1;
                this._coreService.triggerDataEvent(`${n6.C0.ESC}[${e13};${t8}R`);
            }
            return true;
          }
          deviceStatusPrivate(e12) {
            if (6 === e12.params[0]) {
              const e13 = this._activeBuffer.y + 1, t8 = this._activeBuffer.x + 1;
              this._coreService.triggerDataEvent(`${n6.C0.ESC}[?${e13};${t8}R`);
            }
            return true;
          }
          softReset(e12) {
            return this._coreService.isCursorHidden = false, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = l6.DEFAULT_ATTR_DATA.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = false, true;
          }
          setCursorStyle(e12) {
            const t8 = e12.params[0] || 1;
            switch (t8) {
              case 1:
              case 2:
                this._optionsService.options.cursorStyle = "block";
                break;
              case 3:
              case 4:
                this._optionsService.options.cursorStyle = "underline";
                break;
              case 5:
              case 6:
                this._optionsService.options.cursorStyle = "bar";
            }
            const i10 = t8 % 2 == 1;
            return this._optionsService.options.cursorBlink = i10, true;
          }
          setScrollRegion(e12) {
            const t8 = e12.params[0] || 1;
            let i10;
            return (e12.length < 2 || (i10 = e12.params[1]) > this._bufferService.rows || 0 === i10) && (i10 = this._bufferService.rows), i10 > t8 && (this._activeBuffer.scrollTop = t8 - 1, this._activeBuffer.scrollBottom = i10 - 1, this._setCursor(0, 0)), true;
          }
          windowOptions(e12) {
            if (!b3(e12.params[0], this._optionsService.rawOptions.windowOptions)) return true;
            const t8 = e12.length > 1 ? e12.params[1] : 0;
            switch (e12.params[0]) {
              case 14:
                2 !== t8 && this._onRequestWindowsOptionsReport.fire(y3.GET_WIN_SIZE_PIXELS);
                break;
              case 16:
                this._onRequestWindowsOptionsReport.fire(y3.GET_CELL_SIZE_PIXELS);
                break;
              case 18:
                this._bufferService && this._coreService.triggerDataEvent(`${n6.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
                break;
              case 22:
                0 !== t8 && 2 !== t8 || (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > 10 && this._windowTitleStack.shift()), 0 !== t8 && 1 !== t8 || (this._iconNameStack.push(this._iconName), this._iconNameStack.length > 10 && this._iconNameStack.shift());
                break;
              case 23:
                0 !== t8 && 2 !== t8 || this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), 0 !== t8 && 1 !== t8 || this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
            }
            return true;
          }
          saveCursor(e12) {
            return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, true;
          }
          restoreCursor(e12) {
            return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), true;
          }
          setTitle(e12) {
            return this._windowTitle = e12, this._onTitleChange.fire(e12), true;
          }
          setIconName(e12) {
            return this._iconName = e12, true;
          }
          setOrReportIndexedColor(e12) {
            const t8 = [], i10 = e12.split(";");
            for (; i10.length > 1; ) {
              const e13 = i10.shift(), s6 = i10.shift();
              if (/^\d+$/.exec(e13)) {
                const i11 = parseInt(e13);
                if (L2(i11)) if ("?" === s6) t8.push({ type: 0, index: i11 });
                else {
                  const e14 = (0, m3.parseColor)(s6);
                  e14 && t8.push({ type: 1, index: i11, color: e14 });
                }
              }
            }
            return t8.length && this._onColor.fire(t8), true;
          }
          setHyperlink(e12) {
            const t8 = e12.split(";");
            return !(t8.length < 2) && (t8[1] ? this._createHyperlink(t8[0], t8[1]) : !t8[0] && this._finishHyperlink());
          }
          _createHyperlink(e12, t8) {
            this._getCurrentLinkId() && this._finishHyperlink();
            const i10 = e12.split(":");
            let s6;
            const r12 = i10.findIndex(((e13) => e13.startsWith("id=")));
            return -1 !== r12 && (s6 = i10[r12].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({ id: s6, uri: t8 }), this._curAttrData.updateExtended(), true;
          }
          _finishHyperlink() {
            return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), true;
          }
          _setOrReportSpecialColor(e12, t8) {
            const i10 = e12.split(";");
            for (let e13 = 0; e13 < i10.length && !(t8 >= this._specialColors.length); ++e13, ++t8) if ("?" === i10[e13]) this._onColor.fire([{ type: 0, index: this._specialColors[t8] }]);
            else {
              const s6 = (0, m3.parseColor)(i10[e13]);
              s6 && this._onColor.fire([{ type: 1, index: this._specialColors[t8], color: s6 }]);
            }
            return true;
          }
          setOrReportFgColor(e12) {
            return this._setOrReportSpecialColor(e12, 0);
          }
          setOrReportBgColor(e12) {
            return this._setOrReportSpecialColor(e12, 1);
          }
          setOrReportCursorColor(e12) {
            return this._setOrReportSpecialColor(e12, 2);
          }
          restoreIndexedColor(e12) {
            if (!e12) return this._onColor.fire([{ type: 2 }]), true;
            const t8 = [], i10 = e12.split(";");
            for (let e13 = 0; e13 < i10.length; ++e13) if (/^\d+$/.exec(i10[e13])) {
              const s6 = parseInt(i10[e13]);
              L2(s6) && t8.push({ type: 2, index: s6 });
            }
            return t8.length && this._onColor.fire(t8), true;
          }
          restoreFgColor(e12) {
            return this._onColor.fire([{ type: 2, index: 256 }]), true;
          }
          restoreBgColor(e12) {
            return this._onColor.fire([{ type: 2, index: 257 }]), true;
          }
          restoreCursorColor(e12) {
            return this._onColor.fire([{ type: 2, index: 258 }]), true;
          }
          nextLine() {
            return this._activeBuffer.x = 0, this.index(), true;
          }
          keypadApplicationMode() {
            return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire(), true;
          }
          keypadNumericMode() {
            return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire(), true;
          }
          selectDefaultCharset() {
            return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, o10.DEFAULT_CHARSET), true;
          }
          selectCharset(e12) {
            return 2 !== e12.length ? (this.selectDefaultCharset(), true) : ("/" === e12[0] || this._charsetService.setgCharset(S3[e12[0]], o10.CHARSETS[e12[1]] || o10.DEFAULT_CHARSET), true);
          }
          index() {
            return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), true;
          }
          tabSet() {
            return this._activeBuffer.tabs[this._activeBuffer.x] = true, true;
          }
          reverseIndex() {
            if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
              const e12 = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
              this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e12, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
            } else this._activeBuffer.y--, this._restrictCursor();
            return true;
          }
          fullReset() {
            return this._parser.reset(), this._onRequestReset.fire(), true;
          }
          reset() {
            this._curAttrData = l6.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l6.DEFAULT_ATTR_DATA.clone();
          }
          _eraseAttrData() {
            return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= 67108863 & this._curAttrData.bg, this._eraseAttrDataInternal;
          }
          setgLevel(e12) {
            return this._charsetService.setgLevel(e12), true;
          }
          screenAlignmentPattern() {
            const e12 = new u4.CellData();
            e12.content = 1 << 22 | "E".charCodeAt(0), e12.fg = this._curAttrData.fg, e12.bg = this._curAttrData.bg, this._setCursor(0, 0);
            for (let t8 = 0; t8 < this._bufferService.rows; ++t8) {
              const i10 = this._activeBuffer.ybase + this._activeBuffer.y + t8, s6 = this._activeBuffer.lines.get(i10);
              s6 && (s6.fill(e12), s6.isWrapped = false);
            }
            return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), true;
          }
          requestStatusString(e12, t8) {
            const i10 = this._bufferService.buffer, s6 = this._optionsService.rawOptions;
            return ((e13) => (this._coreService.triggerDataEvent(`${n6.C0.ESC}${e13}${n6.C0.ESC}\\`), true))('"q' === e12 ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : '"p' === e12 ? 'P1$r61;1"p' : "r" === e12 ? `P1$r${i10.scrollTop + 1};${i10.scrollBottom + 1}r` : "m" === e12 ? "P1$r0m" : " q" === e12 ? `P1$r${{ block: 2, underline: 4, bar: 6 }[s6.cursorStyle] - (s6.cursorBlink ? 1 : 0)} q` : "P0$r");
          }
          markRangeDirty(e12, t8) {
            this._dirtyRowTracker.markRangeDirty(e12, t8);
          }
        }
        t7.InputHandler = E2;
        let k3 = class {
          constructor(e12) {
            this._bufferService = e12, this.clearRange();
          }
          clearRange() {
            this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
          }
          markDirty(e12) {
            e12 < this.start ? this.start = e12 : e12 > this.end && (this.end = e12);
          }
          markRangeDirty(e12, t8) {
            e12 > t8 && (w2 = e12, e12 = t8, t8 = w2), e12 < this.start && (this.start = e12), t8 > this.end && (this.end = t8);
          }
          markAllDirty() {
            this.markRangeDirty(0, this._bufferService.rows - 1);
          }
        };
        function L2(e12) {
          return 0 <= e12 && e12 < 256;
        }
        k3 = s5([r11(0, v2.IBufferService)], k3);
      }, 844: (e11, t7) => {
        function i9(e12) {
          for (const t8 of e12) t8.dispose();
          e12.length = 0;
        }
        Object.defineProperty(t7, "__esModule", { value: true }), t7.getDisposeArrayDisposable = t7.disposeArray = t7.toDisposable = t7.MutableDisposable = t7.Disposable = void 0, t7.Disposable = class {
          constructor() {
            this._disposables = [], this._isDisposed = false;
          }
          dispose() {
            this._isDisposed = true;
            for (const e12 of this._disposables) e12.dispose();
            this._disposables.length = 0;
          }
          register(e12) {
            return this._disposables.push(e12), e12;
          }
          unregister(e12) {
            const t8 = this._disposables.indexOf(e12);
            -1 !== t8 && this._disposables.splice(t8, 1);
          }
        }, t7.MutableDisposable = class {
          constructor() {
            this._isDisposed = false;
          }
          get value() {
            return this._isDisposed ? void 0 : this._value;
          }
          set value(e12) {
            var t8;
            this._isDisposed || e12 === this._value || (null === (t8 = this._value) || void 0 === t8 || t8.dispose(), this._value = e12);
          }
          clear() {
            this.value = void 0;
          }
          dispose() {
            var e12;
            this._isDisposed = true, null === (e12 = this._value) || void 0 === e12 || e12.dispose(), this._value = void 0;
          }
        }, t7.toDisposable = function(e12) {
          return { dispose: e12 };
        }, t7.disposeArray = i9, t7.getDisposeArrayDisposable = function(e12) {
          return { dispose: () => i9(e12) };
        };
      }, 1505: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.FourKeyMap = t7.TwoKeyMap = void 0;
        class i9 {
          constructor() {
            this._data = {};
          }
          set(e12, t8, i10) {
            this._data[e12] || (this._data[e12] = {}), this._data[e12][t8] = i10;
          }
          get(e12, t8) {
            return this._data[e12] ? this._data[e12][t8] : void 0;
          }
          clear() {
            this._data = {};
          }
        }
        t7.TwoKeyMap = i9, t7.FourKeyMap = class {
          constructor() {
            this._data = new i9();
          }
          set(e12, t8, s5, r11, n6) {
            this._data.get(e12, t8) || this._data.set(e12, t8, new i9()), this._data.get(e12, t8).set(s5, r11, n6);
          }
          get(e12, t8, i10, s5) {
            var r11;
            return null === (r11 = this._data.get(e12, t8)) || void 0 === r11 ? void 0 : r11.get(i10, s5);
          }
          clear() {
            this._data.clear();
          }
        };
      }, 6114: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.isChromeOS = t7.isLinux = t7.isWindows = t7.isIphone = t7.isIpad = t7.isMac = t7.getSafariVersion = t7.isSafari = t7.isLegacyEdge = t7.isFirefox = t7.isNode = void 0, t7.isNode = "undefined" == typeof navigator;
        const i9 = t7.isNode ? "node" : navigator.userAgent, s5 = t7.isNode ? "node" : navigator.platform;
        t7.isFirefox = i9.includes("Firefox"), t7.isLegacyEdge = i9.includes("Edge"), t7.isSafari = /^((?!chrome|android).)*safari/i.test(i9), t7.getSafariVersion = function() {
          if (!t7.isSafari) return 0;
          const e12 = i9.match(/Version\/(\d+)/);
          return null === e12 || e12.length < 2 ? 0 : parseInt(e12[1]);
        }, t7.isMac = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(s5), t7.isIpad = "iPad" === s5, t7.isIphone = "iPhone" === s5, t7.isWindows = ["Windows", "Win16", "Win32", "WinCE"].includes(s5), t7.isLinux = s5.indexOf("Linux") >= 0, t7.isChromeOS = /\bCrOS\b/.test(i9);
      }, 6106: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.SortedList = void 0;
        let i9 = 0;
        t7.SortedList = class {
          constructor(e12) {
            this._getKey = e12, this._array = [];
          }
          clear() {
            this._array.length = 0;
          }
          insert(e12) {
            0 !== this._array.length ? (i9 = this._search(this._getKey(e12)), this._array.splice(i9, 0, e12)) : this._array.push(e12);
          }
          delete(e12) {
            if (0 === this._array.length) return false;
            const t8 = this._getKey(e12);
            if (void 0 === t8) return false;
            if (i9 = this._search(t8), -1 === i9) return false;
            if (this._getKey(this._array[i9]) !== t8) return false;
            do {
              if (this._array[i9] === e12) return this._array.splice(i9, 1), true;
            } while (++i9 < this._array.length && this._getKey(this._array[i9]) === t8);
            return false;
          }
          *getKeyIterator(e12) {
            if (0 !== this._array.length && (i9 = this._search(e12), !(i9 < 0 || i9 >= this._array.length) && this._getKey(this._array[i9]) === e12)) do {
              yield this._array[i9];
            } while (++i9 < this._array.length && this._getKey(this._array[i9]) === e12);
          }
          forEachByKey(e12, t8) {
            if (0 !== this._array.length && (i9 = this._search(e12), !(i9 < 0 || i9 >= this._array.length) && this._getKey(this._array[i9]) === e12)) do {
              t8(this._array[i9]);
            } while (++i9 < this._array.length && this._getKey(this._array[i9]) === e12);
          }
          values() {
            return [...this._array].values();
          }
          _search(e12) {
            let t8 = 0, i10 = this._array.length - 1;
            for (; i10 >= t8; ) {
              let s5 = t8 + i10 >> 1;
              const r11 = this._getKey(this._array[s5]);
              if (r11 > e12) i10 = s5 - 1;
              else {
                if (!(r11 < e12)) {
                  for (; s5 > 0 && this._getKey(this._array[s5 - 1]) === e12; ) s5--;
                  return s5;
                }
                t8 = s5 + 1;
              }
            }
            return t8;
          }
        };
      }, 7226: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.DebouncedIdleTask = t7.IdleTaskQueue = t7.PriorityTaskQueue = void 0;
        const s5 = i9(6114);
        class r11 {
          constructor() {
            this._tasks = [], this._i = 0;
          }
          enqueue(e12) {
            this._tasks.push(e12), this._start();
          }
          flush() {
            for (; this._i < this._tasks.length; ) this._tasks[this._i]() || this._i++;
            this.clear();
          }
          clear() {
            this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
          }
          _start() {
            this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
          }
          _process(e12) {
            this._idleCallback = void 0;
            let t8 = 0, i10 = 0, s6 = e12.timeRemaining(), r12 = 0;
            for (; this._i < this._tasks.length; ) {
              if (t8 = Date.now(), this._tasks[this._i]() || this._i++, t8 = Math.max(1, Date.now() - t8), i10 = Math.max(t8, i10), r12 = e12.timeRemaining(), 1.5 * i10 > r12) return s6 - t8 < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(s6 - t8))}ms`), void this._start();
              s6 = r12;
            }
            this.clear();
          }
        }
        class n6 extends r11 {
          _requestCallback(e12) {
            return setTimeout((() => e12(this._createDeadline(16))));
          }
          _cancelCallback(e12) {
            clearTimeout(e12);
          }
          _createDeadline(e12) {
            const t8 = Date.now() + e12;
            return { timeRemaining: () => Math.max(0, t8 - Date.now()) };
          }
        }
        t7.PriorityTaskQueue = n6, t7.IdleTaskQueue = !s5.isNode && "requestIdleCallback" in window ? class extends r11 {
          _requestCallback(e12) {
            return requestIdleCallback(e12);
          }
          _cancelCallback(e12) {
            cancelIdleCallback(e12);
          }
        } : n6, t7.DebouncedIdleTask = class {
          constructor() {
            this._queue = new t7.IdleTaskQueue();
          }
          set(e12) {
            this._queue.clear(), this._queue.enqueue(e12);
          }
          flush() {
            this._queue.flush();
          }
        };
      }, 9282: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.updateWindowsModeWrappedState = void 0;
        const s5 = i9(643);
        t7.updateWindowsModeWrappedState = function(e12) {
          const t8 = e12.buffer.lines.get(e12.buffer.ybase + e12.buffer.y - 1), i10 = null == t8 ? void 0 : t8.get(e12.cols - 1), r11 = e12.buffer.lines.get(e12.buffer.ybase + e12.buffer.y);
          r11 && i10 && (r11.isWrapped = i10[s5.CHAR_DATA_CODE_INDEX] !== s5.NULL_CELL_CODE && i10[s5.CHAR_DATA_CODE_INDEX] !== s5.WHITESPACE_CELL_CODE);
        };
      }, 3734: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.ExtendedAttrs = t7.AttributeData = void 0;
        class i9 {
          constructor() {
            this.fg = 0, this.bg = 0, this.extended = new s5();
          }
          static toColorRGB(e12) {
            return [e12 >>> 16 & 255, e12 >>> 8 & 255, 255 & e12];
          }
          static fromColorRGB(e12) {
            return (255 & e12[0]) << 16 | (255 & e12[1]) << 8 | 255 & e12[2];
          }
          clone() {
            const e12 = new i9();
            return e12.fg = this.fg, e12.bg = this.bg, e12.extended = this.extended.clone(), e12;
          }
          isInverse() {
            return 67108864 & this.fg;
          }
          isBold() {
            return 134217728 & this.fg;
          }
          isUnderline() {
            return this.hasExtendedAttrs() && 0 !== this.extended.underlineStyle ? 1 : 268435456 & this.fg;
          }
          isBlink() {
            return 536870912 & this.fg;
          }
          isInvisible() {
            return 1073741824 & this.fg;
          }
          isItalic() {
            return 67108864 & this.bg;
          }
          isDim() {
            return 134217728 & this.bg;
          }
          isStrikethrough() {
            return 2147483648 & this.fg;
          }
          isProtected() {
            return 536870912 & this.bg;
          }
          isOverline() {
            return 1073741824 & this.bg;
          }
          getFgColorMode() {
            return 50331648 & this.fg;
          }
          getBgColorMode() {
            return 50331648 & this.bg;
          }
          isFgRGB() {
            return 50331648 == (50331648 & this.fg);
          }
          isBgRGB() {
            return 50331648 == (50331648 & this.bg);
          }
          isFgPalette() {
            return 16777216 == (50331648 & this.fg) || 33554432 == (50331648 & this.fg);
          }
          isBgPalette() {
            return 16777216 == (50331648 & this.bg) || 33554432 == (50331648 & this.bg);
          }
          isFgDefault() {
            return 0 == (50331648 & this.fg);
          }
          isBgDefault() {
            return 0 == (50331648 & this.bg);
          }
          isAttributeDefault() {
            return 0 === this.fg && 0 === this.bg;
          }
          getFgColor() {
            switch (50331648 & this.fg) {
              case 16777216:
              case 33554432:
                return 255 & this.fg;
              case 50331648:
                return 16777215 & this.fg;
              default:
                return -1;
            }
          }
          getBgColor() {
            switch (50331648 & this.bg) {
              case 16777216:
              case 33554432:
                return 255 & this.bg;
              case 50331648:
                return 16777215 & this.bg;
              default:
                return -1;
            }
          }
          hasExtendedAttrs() {
            return 268435456 & this.bg;
          }
          updateExtended() {
            this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
          }
          getUnderlineColor() {
            if (268435456 & this.bg && ~this.extended.underlineColor) switch (50331648 & this.extended.underlineColor) {
              case 16777216:
              case 33554432:
                return 255 & this.extended.underlineColor;
              case 50331648:
                return 16777215 & this.extended.underlineColor;
              default:
                return this.getFgColor();
            }
            return this.getFgColor();
          }
          getUnderlineColorMode() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 & this.extended.underlineColor : this.getFgColorMode();
          }
          isUnderlineColorRGB() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 == (50331648 & this.extended.underlineColor) : this.isFgRGB();
          }
          isUnderlineColorPalette() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 16777216 == (50331648 & this.extended.underlineColor) || 33554432 == (50331648 & this.extended.underlineColor) : this.isFgPalette();
          }
          isUnderlineColorDefault() {
            return 268435456 & this.bg && ~this.extended.underlineColor ? 0 == (50331648 & this.extended.underlineColor) : this.isFgDefault();
          }
          getUnderlineStyle() {
            return 268435456 & this.fg ? 268435456 & this.bg ? this.extended.underlineStyle : 1 : 0;
          }
        }
        t7.AttributeData = i9;
        class s5 {
          get ext() {
            return this._urlId ? -469762049 & this._ext | this.underlineStyle << 26 : this._ext;
          }
          set ext(e12) {
            this._ext = e12;
          }
          get underlineStyle() {
            return this._urlId ? 5 : (469762048 & this._ext) >> 26;
          }
          set underlineStyle(e12) {
            this._ext &= -469762049, this._ext |= e12 << 26 & 469762048;
          }
          get underlineColor() {
            return 67108863 & this._ext;
          }
          set underlineColor(e12) {
            this._ext &= -67108864, this._ext |= 67108863 & e12;
          }
          get urlId() {
            return this._urlId;
          }
          set urlId(e12) {
            this._urlId = e12;
          }
          constructor(e12 = 0, t8 = 0) {
            this._ext = 0, this._urlId = 0, this._ext = e12, this._urlId = t8;
          }
          clone() {
            return new s5(this._ext, this._urlId);
          }
          isEmpty() {
            return 0 === this.underlineStyle && 0 === this._urlId;
          }
        }
        t7.ExtendedAttrs = s5;
      }, 9092: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Buffer = t7.MAX_BUFFER_SIZE = void 0;
        const s5 = i9(6349), r11 = i9(7226), n6 = i9(3734), o10 = i9(8437), a4 = i9(4634), h4 = i9(511), c5 = i9(643), l6 = i9(4863), d3 = i9(7116);
        t7.MAX_BUFFER_SIZE = 4294967295, t7.Buffer = class {
          constructor(e12, t8, i10) {
            this._hasScrollback = e12, this._optionsService = t8, this._bufferService = i10, this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.tabs = {}, this.savedY = 0, this.savedX = 0, this.savedCurAttrData = o10.DEFAULT_ATTR_DATA.clone(), this.savedCharset = d3.DEFAULT_CHARSET, this.markers = [], this._nullCell = h4.CellData.fromCharData([0, c5.NULL_CELL_CHAR, c5.NULL_CELL_WIDTH, c5.NULL_CELL_CODE]), this._whitespaceCell = h4.CellData.fromCharData([0, c5.WHITESPACE_CELL_CHAR, c5.WHITESPACE_CELL_WIDTH, c5.WHITESPACE_CELL_CODE]), this._isClearing = false, this._memoryCleanupQueue = new r11.IdleTaskQueue(), this._memoryCleanupPosition = 0, this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new s5.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
          }
          getNullCell(e12) {
            return e12 ? (this._nullCell.fg = e12.fg, this._nullCell.bg = e12.bg, this._nullCell.extended = e12.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new n6.ExtendedAttrs()), this._nullCell;
          }
          getWhitespaceCell(e12) {
            return e12 ? (this._whitespaceCell.fg = e12.fg, this._whitespaceCell.bg = e12.bg, this._whitespaceCell.extended = e12.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new n6.ExtendedAttrs()), this._whitespaceCell;
          }
          getBlankLine(e12, t8) {
            return new o10.BufferLine(this._bufferService.cols, this.getNullCell(e12), t8);
          }
          get hasScrollback() {
            return this._hasScrollback && this.lines.maxLength > this._rows;
          }
          get isCursorInViewport() {
            const e12 = this.ybase + this.y - this.ydisp;
            return e12 >= 0 && e12 < this._rows;
          }
          _getCorrectBufferLength(e12) {
            if (!this._hasScrollback) return e12;
            const i10 = e12 + this._optionsService.rawOptions.scrollback;
            return i10 > t7.MAX_BUFFER_SIZE ? t7.MAX_BUFFER_SIZE : i10;
          }
          fillViewportRows(e12) {
            if (0 === this.lines.length) {
              void 0 === e12 && (e12 = o10.DEFAULT_ATTR_DATA);
              let t8 = this._rows;
              for (; t8--; ) this.lines.push(this.getBlankLine(e12));
            }
          }
          clear() {
            this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new s5.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
          }
          resize(e12, t8) {
            const i10 = this.getNullCell(o10.DEFAULT_ATTR_DATA);
            let s6 = 0;
            const r12 = this._getCorrectBufferLength(t8);
            if (r12 > this.lines.maxLength && (this.lines.maxLength = r12), this.lines.length > 0) {
              if (this._cols < e12) for (let t9 = 0; t9 < this.lines.length; t9++) s6 += +this.lines.get(t9).resize(e12, i10);
              let n7 = 0;
              if (this._rows < t8) for (let s7 = this._rows; s7 < t8; s7++) this.lines.length < t8 + this.ybase && (this._optionsService.rawOptions.windowsMode || void 0 !== this._optionsService.rawOptions.windowsPty.backend || void 0 !== this._optionsService.rawOptions.windowsPty.buildNumber ? this.lines.push(new o10.BufferLine(e12, i10)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + n7 + 1 ? (this.ybase--, n7++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new o10.BufferLine(e12, i10)));
              else for (let e13 = this._rows; e13 > t8; e13--) this.lines.length > t8 + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
              if (r12 < this.lines.maxLength) {
                const e13 = this.lines.length - r12;
                e13 > 0 && (this.lines.trimStart(e13), this.ybase = Math.max(this.ybase - e13, 0), this.ydisp = Math.max(this.ydisp - e13, 0), this.savedY = Math.max(this.savedY - e13, 0)), this.lines.maxLength = r12;
              }
              this.x = Math.min(this.x, e12 - 1), this.y = Math.min(this.y, t8 - 1), n7 && (this.y += n7), this.savedX = Math.min(this.savedX, e12 - 1), this.scrollTop = 0;
            }
            if (this.scrollBottom = t8 - 1, this._isReflowEnabled && (this._reflow(e12, t8), this._cols > e12)) for (let t9 = 0; t9 < this.lines.length; t9++) s6 += +this.lines.get(t9).resize(e12, i10);
            this._cols = e12, this._rows = t8, this._memoryCleanupQueue.clear(), s6 > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue((() => this._batchedMemoryCleanup())));
          }
          _batchedMemoryCleanup() {
            let e12 = true;
            this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, e12 = false);
            let t8 = 0;
            for (; this._memoryCleanupPosition < this.lines.length; ) if (t8 += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), t8 > 100) return true;
            return e12;
          }
          get _isReflowEnabled() {
            const e12 = this._optionsService.rawOptions.windowsPty;
            return e12 && e12.buildNumber ? this._hasScrollback && "conpty" === e12.backend && e12.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
          }
          _reflow(e12, t8) {
            this._cols !== e12 && (e12 > this._cols ? this._reflowLarger(e12, t8) : this._reflowSmaller(e12, t8));
          }
          _reflowLarger(e12, t8) {
            const i10 = (0, a4.reflowLargerGetLinesToRemove)(this.lines, this._cols, e12, this.ybase + this.y, this.getNullCell(o10.DEFAULT_ATTR_DATA));
            if (i10.length > 0) {
              const s6 = (0, a4.reflowLargerCreateNewLayout)(this.lines, i10);
              (0, a4.reflowLargerApplyNewLayout)(this.lines, s6.layout), this._reflowLargerAdjustViewport(e12, t8, s6.countRemoved);
            }
          }
          _reflowLargerAdjustViewport(e12, t8, i10) {
            const s6 = this.getNullCell(o10.DEFAULT_ATTR_DATA);
            let r12 = i10;
            for (; r12-- > 0; ) 0 === this.ybase ? (this.y > 0 && this.y--, this.lines.length < t8 && this.lines.push(new o10.BufferLine(e12, s6))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
            this.savedY = Math.max(this.savedY - i10, 0);
          }
          _reflowSmaller(e12, t8) {
            const i10 = this.getNullCell(o10.DEFAULT_ATTR_DATA), s6 = [];
            let r12 = 0;
            for (let n7 = this.lines.length - 1; n7 >= 0; n7--) {
              let h5 = this.lines.get(n7);
              if (!h5 || !h5.isWrapped && h5.getTrimmedLength() <= e12) continue;
              const c6 = [h5];
              for (; h5.isWrapped && n7 > 0; ) h5 = this.lines.get(--n7), c6.unshift(h5);
              const l7 = this.ybase + this.y;
              if (l7 >= n7 && l7 < n7 + c6.length) continue;
              const d4 = c6[c6.length - 1].getTrimmedLength(), _3 = (0, a4.reflowSmallerGetNewLineLengths)(c6, this._cols, e12), u4 = _3.length - c6.length;
              let f3;
              f3 = 0 === this.ybase && this.y !== this.lines.length - 1 ? Math.max(0, this.y - this.lines.maxLength + u4) : Math.max(0, this.lines.length - this.lines.maxLength + u4);
              const v2 = [];
              for (let e13 = 0; e13 < u4; e13++) {
                const e14 = this.getBlankLine(o10.DEFAULT_ATTR_DATA, true);
                v2.push(e14);
              }
              v2.length > 0 && (s6.push({ start: n7 + c6.length + r12, newLines: v2 }), r12 += v2.length), c6.push(...v2);
              let p4 = _3.length - 1, g2 = _3[p4];
              0 === g2 && (p4--, g2 = _3[p4]);
              let m3 = c6.length - u4 - 1, S3 = d4;
              for (; m3 >= 0; ) {
                const e13 = Math.min(S3, g2);
                if (void 0 === c6[p4]) break;
                if (c6[p4].copyCellsFrom(c6[m3], S3 - e13, g2 - e13, e13, true), g2 -= e13, 0 === g2 && (p4--, g2 = _3[p4]), S3 -= e13, 0 === S3) {
                  m3--;
                  const e14 = Math.max(m3, 0);
                  S3 = (0, a4.getWrappedLineTrimmedLength)(c6, e14, this._cols);
                }
              }
              for (let t9 = 0; t9 < c6.length; t9++) _3[t9] < e12 && c6[t9].setCell(_3[t9], i10);
              let C3 = u4 - f3;
              for (; C3-- > 0; ) 0 === this.ybase ? this.y < t8 - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + r12) - t8 && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
              this.savedY = Math.min(this.savedY + u4, this.ybase + t8 - 1);
            }
            if (s6.length > 0) {
              const e13 = [], t9 = [];
              for (let e14 = 0; e14 < this.lines.length; e14++) t9.push(this.lines.get(e14));
              const i11 = this.lines.length;
              let n7 = i11 - 1, o11 = 0, a5 = s6[o11];
              this.lines.length = Math.min(this.lines.maxLength, this.lines.length + r12);
              let h5 = 0;
              for (let c7 = Math.min(this.lines.maxLength - 1, i11 + r12 - 1); c7 >= 0; c7--) if (a5 && a5.start > n7 + h5) {
                for (let e14 = a5.newLines.length - 1; e14 >= 0; e14--) this.lines.set(c7--, a5.newLines[e14]);
                c7++, e13.push({ index: n7 + 1, amount: a5.newLines.length }), h5 += a5.newLines.length, a5 = s6[++o11];
              } else this.lines.set(c7, t9[n7--]);
              let c6 = 0;
              for (let t10 = e13.length - 1; t10 >= 0; t10--) e13[t10].index += c6, this.lines.onInsertEmitter.fire(e13[t10]), c6 += e13[t10].amount;
              const l7 = Math.max(0, i11 + r12 - this.lines.maxLength);
              l7 > 0 && this.lines.onTrimEmitter.fire(l7);
            }
          }
          translateBufferLineToString(e12, t8, i10 = 0, s6) {
            const r12 = this.lines.get(e12);
            return r12 ? r12.translateToString(t8, i10, s6) : "";
          }
          getWrappedRangeForLine(e12) {
            let t8 = e12, i10 = e12;
            for (; t8 > 0 && this.lines.get(t8).isWrapped; ) t8--;
            for (; i10 + 1 < this.lines.length && this.lines.get(i10 + 1).isWrapped; ) i10++;
            return { first: t8, last: i10 };
          }
          setupTabStops(e12) {
            for (null != e12 ? this.tabs[e12] || (e12 = this.prevStop(e12)) : (this.tabs = {}, e12 = 0); e12 < this._cols; e12 += this._optionsService.rawOptions.tabStopWidth) this.tabs[e12] = true;
          }
          prevStop(e12) {
            for (null == e12 && (e12 = this.x); !this.tabs[--e12] && e12 > 0; ) ;
            return e12 >= this._cols ? this._cols - 1 : e12 < 0 ? 0 : e12;
          }
          nextStop(e12) {
            for (null == e12 && (e12 = this.x); !this.tabs[++e12] && e12 < this._cols; ) ;
            return e12 >= this._cols ? this._cols - 1 : e12 < 0 ? 0 : e12;
          }
          clearMarkers(e12) {
            this._isClearing = true;
            for (let t8 = 0; t8 < this.markers.length; t8++) this.markers[t8].line === e12 && (this.markers[t8].dispose(), this.markers.splice(t8--, 1));
            this._isClearing = false;
          }
          clearAllMarkers() {
            this._isClearing = true;
            for (let e12 = 0; e12 < this.markers.length; e12++) this.markers[e12].dispose(), this.markers.splice(e12--, 1);
            this._isClearing = false;
          }
          addMarker(e12) {
            const t8 = new l6.Marker(e12);
            return this.markers.push(t8), t8.register(this.lines.onTrim(((e13) => {
              t8.line -= e13, t8.line < 0 && t8.dispose();
            }))), t8.register(this.lines.onInsert(((e13) => {
              t8.line >= e13.index && (t8.line += e13.amount);
            }))), t8.register(this.lines.onDelete(((e13) => {
              t8.line >= e13.index && t8.line < e13.index + e13.amount && t8.dispose(), t8.line > e13.index && (t8.line -= e13.amount);
            }))), t8.register(t8.onDispose((() => this._removeMarker(t8)))), t8;
          }
          _removeMarker(e12) {
            this._isClearing || this.markers.splice(this.markers.indexOf(e12), 1);
          }
        };
      }, 8437: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferLine = t7.DEFAULT_ATTR_DATA = void 0;
        const s5 = i9(3734), r11 = i9(511), n6 = i9(643), o10 = i9(482);
        t7.DEFAULT_ATTR_DATA = Object.freeze(new s5.AttributeData());
        let a4 = 0;
        class h4 {
          constructor(e12, t8, i10 = false) {
            this.isWrapped = i10, this._combined = {}, this._extendedAttrs = {}, this._data = new Uint32Array(3 * e12);
            const s6 = t8 || r11.CellData.fromCharData([0, n6.NULL_CELL_CHAR, n6.NULL_CELL_WIDTH, n6.NULL_CELL_CODE]);
            for (let t9 = 0; t9 < e12; ++t9) this.setCell(t9, s6);
            this.length = e12;
          }
          get(e12) {
            const t8 = this._data[3 * e12 + 0], i10 = 2097151 & t8;
            return [this._data[3 * e12 + 1], 2097152 & t8 ? this._combined[e12] : i10 ? (0, o10.stringFromCodePoint)(i10) : "", t8 >> 22, 2097152 & t8 ? this._combined[e12].charCodeAt(this._combined[e12].length - 1) : i10];
          }
          set(e12, t8) {
            this._data[3 * e12 + 1] = t8[n6.CHAR_DATA_ATTR_INDEX], t8[n6.CHAR_DATA_CHAR_INDEX].length > 1 ? (this._combined[e12] = t8[1], this._data[3 * e12 + 0] = 2097152 | e12 | t8[n6.CHAR_DATA_WIDTH_INDEX] << 22) : this._data[3 * e12 + 0] = t8[n6.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | t8[n6.CHAR_DATA_WIDTH_INDEX] << 22;
          }
          getWidth(e12) {
            return this._data[3 * e12 + 0] >> 22;
          }
          hasWidth(e12) {
            return 12582912 & this._data[3 * e12 + 0];
          }
          getFg(e12) {
            return this._data[3 * e12 + 1];
          }
          getBg(e12) {
            return this._data[3 * e12 + 2];
          }
          hasContent(e12) {
            return 4194303 & this._data[3 * e12 + 0];
          }
          getCodePoint(e12) {
            const t8 = this._data[3 * e12 + 0];
            return 2097152 & t8 ? this._combined[e12].charCodeAt(this._combined[e12].length - 1) : 2097151 & t8;
          }
          isCombined(e12) {
            return 2097152 & this._data[3 * e12 + 0];
          }
          getString(e12) {
            const t8 = this._data[3 * e12 + 0];
            return 2097152 & t8 ? this._combined[e12] : 2097151 & t8 ? (0, o10.stringFromCodePoint)(2097151 & t8) : "";
          }
          isProtected(e12) {
            return 536870912 & this._data[3 * e12 + 2];
          }
          loadCell(e12, t8) {
            return a4 = 3 * e12, t8.content = this._data[a4 + 0], t8.fg = this._data[a4 + 1], t8.bg = this._data[a4 + 2], 2097152 & t8.content && (t8.combinedData = this._combined[e12]), 268435456 & t8.bg && (t8.extended = this._extendedAttrs[e12]), t8;
          }
          setCell(e12, t8) {
            2097152 & t8.content && (this._combined[e12] = t8.combinedData), 268435456 & t8.bg && (this._extendedAttrs[e12] = t8.extended), this._data[3 * e12 + 0] = t8.content, this._data[3 * e12 + 1] = t8.fg, this._data[3 * e12 + 2] = t8.bg;
          }
          setCellFromCodePoint(e12, t8, i10, s6, r12, n7) {
            268435456 & r12 && (this._extendedAttrs[e12] = n7), this._data[3 * e12 + 0] = t8 | i10 << 22, this._data[3 * e12 + 1] = s6, this._data[3 * e12 + 2] = r12;
          }
          addCodepointToCell(e12, t8) {
            let i10 = this._data[3 * e12 + 0];
            2097152 & i10 ? this._combined[e12] += (0, o10.stringFromCodePoint)(t8) : (2097151 & i10 ? (this._combined[e12] = (0, o10.stringFromCodePoint)(2097151 & i10) + (0, o10.stringFromCodePoint)(t8), i10 &= -2097152, i10 |= 2097152) : i10 = t8 | 1 << 22, this._data[3 * e12 + 0] = i10);
          }
          insertCells(e12, t8, i10, n7) {
            if ((e12 %= this.length) && 2 === this.getWidth(e12 - 1) && this.setCellFromCodePoint(e12 - 1, 0, 1, (null == n7 ? void 0 : n7.fg) || 0, (null == n7 ? void 0 : n7.bg) || 0, (null == n7 ? void 0 : n7.extended) || new s5.ExtendedAttrs()), t8 < this.length - e12) {
              const s6 = new r11.CellData();
              for (let i11 = this.length - e12 - t8 - 1; i11 >= 0; --i11) this.setCell(e12 + t8 + i11, this.loadCell(e12 + i11, s6));
              for (let s7 = 0; s7 < t8; ++s7) this.setCell(e12 + s7, i10);
            } else for (let t9 = e12; t9 < this.length; ++t9) this.setCell(t9, i10);
            2 === this.getWidth(this.length - 1) && this.setCellFromCodePoint(this.length - 1, 0, 1, (null == n7 ? void 0 : n7.fg) || 0, (null == n7 ? void 0 : n7.bg) || 0, (null == n7 ? void 0 : n7.extended) || new s5.ExtendedAttrs());
          }
          deleteCells(e12, t8, i10, n7) {
            if (e12 %= this.length, t8 < this.length - e12) {
              const s6 = new r11.CellData();
              for (let i11 = 0; i11 < this.length - e12 - t8; ++i11) this.setCell(e12 + i11, this.loadCell(e12 + t8 + i11, s6));
              for (let e13 = this.length - t8; e13 < this.length; ++e13) this.setCell(e13, i10);
            } else for (let t9 = e12; t9 < this.length; ++t9) this.setCell(t9, i10);
            e12 && 2 === this.getWidth(e12 - 1) && this.setCellFromCodePoint(e12 - 1, 0, 1, (null == n7 ? void 0 : n7.fg) || 0, (null == n7 ? void 0 : n7.bg) || 0, (null == n7 ? void 0 : n7.extended) || new s5.ExtendedAttrs()), 0 !== this.getWidth(e12) || this.hasContent(e12) || this.setCellFromCodePoint(e12, 0, 1, (null == n7 ? void 0 : n7.fg) || 0, (null == n7 ? void 0 : n7.bg) || 0, (null == n7 ? void 0 : n7.extended) || new s5.ExtendedAttrs());
          }
          replaceCells(e12, t8, i10, r12, n7 = false) {
            if (n7) for (e12 && 2 === this.getWidth(e12 - 1) && !this.isProtected(e12 - 1) && this.setCellFromCodePoint(e12 - 1, 0, 1, (null == r12 ? void 0 : r12.fg) || 0, (null == r12 ? void 0 : r12.bg) || 0, (null == r12 ? void 0 : r12.extended) || new s5.ExtendedAttrs()), t8 < this.length && 2 === this.getWidth(t8 - 1) && !this.isProtected(t8) && this.setCellFromCodePoint(t8, 0, 1, (null == r12 ? void 0 : r12.fg) || 0, (null == r12 ? void 0 : r12.bg) || 0, (null == r12 ? void 0 : r12.extended) || new s5.ExtendedAttrs()); e12 < t8 && e12 < this.length; ) this.isProtected(e12) || this.setCell(e12, i10), e12++;
            else for (e12 && 2 === this.getWidth(e12 - 1) && this.setCellFromCodePoint(e12 - 1, 0, 1, (null == r12 ? void 0 : r12.fg) || 0, (null == r12 ? void 0 : r12.bg) || 0, (null == r12 ? void 0 : r12.extended) || new s5.ExtendedAttrs()), t8 < this.length && 2 === this.getWidth(t8 - 1) && this.setCellFromCodePoint(t8, 0, 1, (null == r12 ? void 0 : r12.fg) || 0, (null == r12 ? void 0 : r12.bg) || 0, (null == r12 ? void 0 : r12.extended) || new s5.ExtendedAttrs()); e12 < t8 && e12 < this.length; ) this.setCell(e12++, i10);
          }
          resize(e12, t8) {
            if (e12 === this.length) return 4 * this._data.length * 2 < this._data.buffer.byteLength;
            const i10 = 3 * e12;
            if (e12 > this.length) {
              if (this._data.buffer.byteLength >= 4 * i10) this._data = new Uint32Array(this._data.buffer, 0, i10);
              else {
                const e13 = new Uint32Array(i10);
                e13.set(this._data), this._data = e13;
              }
              for (let i11 = this.length; i11 < e12; ++i11) this.setCell(i11, t8);
            } else {
              this._data = this._data.subarray(0, i10);
              const t9 = Object.keys(this._combined);
              for (let i11 = 0; i11 < t9.length; i11++) {
                const s7 = parseInt(t9[i11], 10);
                s7 >= e12 && delete this._combined[s7];
              }
              const s6 = Object.keys(this._extendedAttrs);
              for (let t10 = 0; t10 < s6.length; t10++) {
                const i11 = parseInt(s6[t10], 10);
                i11 >= e12 && delete this._extendedAttrs[i11];
              }
            }
            return this.length = e12, 4 * i10 * 2 < this._data.buffer.byteLength;
          }
          cleanupMemory() {
            if (4 * this._data.length * 2 < this._data.buffer.byteLength) {
              const e12 = new Uint32Array(this._data.length);
              return e12.set(this._data), this._data = e12, 1;
            }
            return 0;
          }
          fill(e12, t8 = false) {
            if (t8) for (let t9 = 0; t9 < this.length; ++t9) this.isProtected(t9) || this.setCell(t9, e12);
            else {
              this._combined = {}, this._extendedAttrs = {};
              for (let t9 = 0; t9 < this.length; ++t9) this.setCell(t9, e12);
            }
          }
          copyFrom(e12) {
            this.length !== e12.length ? this._data = new Uint32Array(e12._data) : this._data.set(e12._data), this.length = e12.length, this._combined = {};
            for (const t8 in e12._combined) this._combined[t8] = e12._combined[t8];
            this._extendedAttrs = {};
            for (const t8 in e12._extendedAttrs) this._extendedAttrs[t8] = e12._extendedAttrs[t8];
            this.isWrapped = e12.isWrapped;
          }
          clone() {
            const e12 = new h4(0);
            e12._data = new Uint32Array(this._data), e12.length = this.length;
            for (const t8 in this._combined) e12._combined[t8] = this._combined[t8];
            for (const t8 in this._extendedAttrs) e12._extendedAttrs[t8] = this._extendedAttrs[t8];
            return e12.isWrapped = this.isWrapped, e12;
          }
          getTrimmedLength() {
            for (let e12 = this.length - 1; e12 >= 0; --e12) if (4194303 & this._data[3 * e12 + 0]) return e12 + (this._data[3 * e12 + 0] >> 22);
            return 0;
          }
          getNoBgTrimmedLength() {
            for (let e12 = this.length - 1; e12 >= 0; --e12) if (4194303 & this._data[3 * e12 + 0] || 50331648 & this._data[3 * e12 + 2]) return e12 + (this._data[3 * e12 + 0] >> 22);
            return 0;
          }
          copyCellsFrom(e12, t8, i10, s6, r12) {
            const n7 = e12._data;
            if (r12) for (let r13 = s6 - 1; r13 >= 0; r13--) {
              for (let e13 = 0; e13 < 3; e13++) this._data[3 * (i10 + r13) + e13] = n7[3 * (t8 + r13) + e13];
              268435456 & n7[3 * (t8 + r13) + 2] && (this._extendedAttrs[i10 + r13] = e12._extendedAttrs[t8 + r13]);
            }
            else for (let r13 = 0; r13 < s6; r13++) {
              for (let e13 = 0; e13 < 3; e13++) this._data[3 * (i10 + r13) + e13] = n7[3 * (t8 + r13) + e13];
              268435456 & n7[3 * (t8 + r13) + 2] && (this._extendedAttrs[i10 + r13] = e12._extendedAttrs[t8 + r13]);
            }
            const o11 = Object.keys(e12._combined);
            for (let s7 = 0; s7 < o11.length; s7++) {
              const r13 = parseInt(o11[s7], 10);
              r13 >= t8 && (this._combined[r13 - t8 + i10] = e12._combined[r13]);
            }
          }
          translateToString(e12 = false, t8 = 0, i10 = this.length) {
            e12 && (i10 = Math.min(i10, this.getTrimmedLength()));
            let s6 = "";
            for (; t8 < i10; ) {
              const e13 = this._data[3 * t8 + 0], i11 = 2097151 & e13;
              s6 += 2097152 & e13 ? this._combined[t8] : i11 ? (0, o10.stringFromCodePoint)(i11) : n6.WHITESPACE_CELL_CHAR, t8 += e13 >> 22 || 1;
            }
            return s6;
          }
        }
        t7.BufferLine = h4;
      }, 4841: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.getRangeLength = void 0, t7.getRangeLength = function(e12, t8) {
          if (e12.start.y > e12.end.y) throw new Error(`Buffer range end (${e12.end.x}, ${e12.end.y}) cannot be before start (${e12.start.x}, ${e12.start.y})`);
          return t8 * (e12.end.y - e12.start.y) + (e12.end.x - e12.start.x + 1);
        };
      }, 4634: (e11, t7) => {
        function i9(e12, t8, i10) {
          if (t8 === e12.length - 1) return e12[t8].getTrimmedLength();
          const s5 = !e12[t8].hasContent(i10 - 1) && 1 === e12[t8].getWidth(i10 - 1), r11 = 2 === e12[t8 + 1].getWidth(0);
          return s5 && r11 ? i10 - 1 : i10;
        }
        Object.defineProperty(t7, "__esModule", { value: true }), t7.getWrappedLineTrimmedLength = t7.reflowSmallerGetNewLineLengths = t7.reflowLargerApplyNewLayout = t7.reflowLargerCreateNewLayout = t7.reflowLargerGetLinesToRemove = void 0, t7.reflowLargerGetLinesToRemove = function(e12, t8, s5, r11, n6) {
          const o10 = [];
          for (let a4 = 0; a4 < e12.length - 1; a4++) {
            let h4 = a4, c5 = e12.get(++h4);
            if (!c5.isWrapped) continue;
            const l6 = [e12.get(a4)];
            for (; h4 < e12.length && c5.isWrapped; ) l6.push(c5), c5 = e12.get(++h4);
            if (r11 >= a4 && r11 < h4) {
              a4 += l6.length - 1;
              continue;
            }
            let d3 = 0, _3 = i9(l6, d3, t8), u4 = 1, f3 = 0;
            for (; u4 < l6.length; ) {
              const e13 = i9(l6, u4, t8), r12 = e13 - f3, o11 = s5 - _3, a5 = Math.min(r12, o11);
              l6[d3].copyCellsFrom(l6[u4], f3, _3, a5, false), _3 += a5, _3 === s5 && (d3++, _3 = 0), f3 += a5, f3 === e13 && (u4++, f3 = 0), 0 === _3 && 0 !== d3 && 2 === l6[d3 - 1].getWidth(s5 - 1) && (l6[d3].copyCellsFrom(l6[d3 - 1], s5 - 1, _3++, 1, false), l6[d3 - 1].setCell(s5 - 1, n6));
            }
            l6[d3].replaceCells(_3, s5, n6);
            let v2 = 0;
            for (let e13 = l6.length - 1; e13 > 0 && (e13 > d3 || 0 === l6[e13].getTrimmedLength()); e13--) v2++;
            v2 > 0 && (o10.push(a4 + l6.length - v2), o10.push(v2)), a4 += l6.length - 1;
          }
          return o10;
        }, t7.reflowLargerCreateNewLayout = function(e12, t8) {
          const i10 = [];
          let s5 = 0, r11 = t8[s5], n6 = 0;
          for (let o10 = 0; o10 < e12.length; o10++) if (r11 === o10) {
            const i11 = t8[++s5];
            e12.onDeleteEmitter.fire({ index: o10 - n6, amount: i11 }), o10 += i11 - 1, n6 += i11, r11 = t8[++s5];
          } else i10.push(o10);
          return { layout: i10, countRemoved: n6 };
        }, t7.reflowLargerApplyNewLayout = function(e12, t8) {
          const i10 = [];
          for (let s5 = 0; s5 < t8.length; s5++) i10.push(e12.get(t8[s5]));
          for (let t9 = 0; t9 < i10.length; t9++) e12.set(t9, i10[t9]);
          e12.length = t8.length;
        }, t7.reflowSmallerGetNewLineLengths = function(e12, t8, s5) {
          const r11 = [], n6 = e12.map(((s6, r12) => i9(e12, r12, t8))).reduce(((e13, t9) => e13 + t9));
          let o10 = 0, a4 = 0, h4 = 0;
          for (; h4 < n6; ) {
            if (n6 - h4 < s5) {
              r11.push(n6 - h4);
              break;
            }
            o10 += s5;
            const c5 = i9(e12, a4, t8);
            o10 > c5 && (o10 -= c5, a4++);
            const l6 = 2 === e12[a4].getWidth(o10 - 1);
            l6 && o10--;
            const d3 = l6 ? s5 - 1 : s5;
            r11.push(d3), h4 += d3;
          }
          return r11;
        }, t7.getWrappedLineTrimmedLength = i9;
      }, 5295: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferSet = void 0;
        const s5 = i9(8460), r11 = i9(844), n6 = i9(9092);
        class o10 extends r11.Disposable {
          constructor(e12, t8) {
            super(), this._optionsService = e12, this._bufferService = t8, this._onBufferActivate = this.register(new s5.EventEmitter()), this.onBufferActivate = this._onBufferActivate.event, this.reset(), this.register(this._optionsService.onSpecificOptionChange("scrollback", (() => this.resize(this._bufferService.cols, this._bufferService.rows)))), this.register(this._optionsService.onSpecificOptionChange("tabStopWidth", (() => this.setupTabStops())));
          }
          reset() {
            this._normal = new n6.Buffer(true, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new n6.Buffer(false, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }), this.setupTabStops();
          }
          get alt() {
            return this._alt;
          }
          get active() {
            return this._activeBuffer;
          }
          get normal() {
            return this._normal;
          }
          activateNormalBuffer() {
            this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }));
          }
          activateAltBuffer(e12) {
            this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e12), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({ activeBuffer: this._alt, inactiveBuffer: this._normal }));
          }
          resize(e12, t8) {
            this._normal.resize(e12, t8), this._alt.resize(e12, t8), this.setupTabStops(e12);
          }
          setupTabStops(e12) {
            this._normal.setupTabStops(e12), this._alt.setupTabStops(e12);
          }
        }
        t7.BufferSet = o10;
      }, 511: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CellData = void 0;
        const s5 = i9(482), r11 = i9(643), n6 = i9(3734);
        class o10 extends n6.AttributeData {
          constructor() {
            super(...arguments), this.content = 0, this.fg = 0, this.bg = 0, this.extended = new n6.ExtendedAttrs(), this.combinedData = "";
          }
          static fromCharData(e12) {
            const t8 = new o10();
            return t8.setFromCharData(e12), t8;
          }
          isCombined() {
            return 2097152 & this.content;
          }
          getWidth() {
            return this.content >> 22;
          }
          getChars() {
            return 2097152 & this.content ? this.combinedData : 2097151 & this.content ? (0, s5.stringFromCodePoint)(2097151 & this.content) : "";
          }
          getCode() {
            return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : 2097151 & this.content;
          }
          setFromCharData(e12) {
            this.fg = e12[r11.CHAR_DATA_ATTR_INDEX], this.bg = 0;
            let t8 = false;
            if (e12[r11.CHAR_DATA_CHAR_INDEX].length > 2) t8 = true;
            else if (2 === e12[r11.CHAR_DATA_CHAR_INDEX].length) {
              const i10 = e12[r11.CHAR_DATA_CHAR_INDEX].charCodeAt(0);
              if (55296 <= i10 && i10 <= 56319) {
                const s6 = e12[r11.CHAR_DATA_CHAR_INDEX].charCodeAt(1);
                56320 <= s6 && s6 <= 57343 ? this.content = 1024 * (i10 - 55296) + s6 - 56320 + 65536 | e12[r11.CHAR_DATA_WIDTH_INDEX] << 22 : t8 = true;
              } else t8 = true;
            } else this.content = e12[r11.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | e12[r11.CHAR_DATA_WIDTH_INDEX] << 22;
            t8 && (this.combinedData = e12[r11.CHAR_DATA_CHAR_INDEX], this.content = 2097152 | e12[r11.CHAR_DATA_WIDTH_INDEX] << 22);
          }
          getAsCharData() {
            return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
          }
        }
        t7.CellData = o10;
      }, 643: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.WHITESPACE_CELL_CODE = t7.WHITESPACE_CELL_WIDTH = t7.WHITESPACE_CELL_CHAR = t7.NULL_CELL_CODE = t7.NULL_CELL_WIDTH = t7.NULL_CELL_CHAR = t7.CHAR_DATA_CODE_INDEX = t7.CHAR_DATA_WIDTH_INDEX = t7.CHAR_DATA_CHAR_INDEX = t7.CHAR_DATA_ATTR_INDEX = t7.DEFAULT_EXT = t7.DEFAULT_ATTR = t7.DEFAULT_COLOR = void 0, t7.DEFAULT_COLOR = 0, t7.DEFAULT_ATTR = 256 | t7.DEFAULT_COLOR << 9, t7.DEFAULT_EXT = 0, t7.CHAR_DATA_ATTR_INDEX = 0, t7.CHAR_DATA_CHAR_INDEX = 1, t7.CHAR_DATA_WIDTH_INDEX = 2, t7.CHAR_DATA_CODE_INDEX = 3, t7.NULL_CELL_CHAR = "", t7.NULL_CELL_WIDTH = 1, t7.NULL_CELL_CODE = 0, t7.WHITESPACE_CELL_CHAR = " ", t7.WHITESPACE_CELL_WIDTH = 1, t7.WHITESPACE_CELL_CODE = 32;
      }, 4863: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Marker = void 0;
        const s5 = i9(8460), r11 = i9(844);
        class n6 {
          get id() {
            return this._id;
          }
          constructor(e12) {
            this.line = e12, this.isDisposed = false, this._disposables = [], this._id = n6._nextId++, this._onDispose = this.register(new s5.EventEmitter()), this.onDispose = this._onDispose.event;
          }
          dispose() {
            this.isDisposed || (this.isDisposed = true, this.line = -1, this._onDispose.fire(), (0, r11.disposeArray)(this._disposables), this._disposables.length = 0);
          }
          register(e12) {
            return this._disposables.push(e12), e12;
          }
        }
        t7.Marker = n6, n6._nextId = 1;
      }, 7116: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.DEFAULT_CHARSET = t7.CHARSETS = void 0, t7.CHARSETS = {}, t7.DEFAULT_CHARSET = t7.CHARSETS.B, t7.CHARSETS[0] = { "`": "\u25C6", a: "\u2592", b: "\u2409", c: "\u240C", d: "\u240D", e: "\u240A", f: "\xB0", g: "\xB1", h: "\u2424", i: "\u240B", j: "\u2518", k: "\u2510", l: "\u250C", m: "\u2514", n: "\u253C", o: "\u23BA", p: "\u23BB", q: "\u2500", r: "\u23BC", s: "\u23BD", t: "\u251C", u: "\u2524", v: "\u2534", w: "\u252C", x: "\u2502", y: "\u2264", z: "\u2265", "{": "\u03C0", "|": "\u2260", "}": "\xA3", "~": "\xB7" }, t7.CHARSETS.A = { "#": "\xA3" }, t7.CHARSETS.B = void 0, t7.CHARSETS[4] = { "#": "\xA3", "@": "\xBE", "[": "ij", "\\": "\xBD", "]": "|", "{": "\xA8", "|": "f", "}": "\xBC", "~": "\xB4" }, t7.CHARSETS.C = t7.CHARSETS[5] = { "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" }, t7.CHARSETS.R = { "#": "\xA3", "@": "\xE0", "[": "\xB0", "\\": "\xE7", "]": "\xA7", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xA8" }, t7.CHARSETS.Q = { "@": "\xE0", "[": "\xE2", "\\": "\xE7", "]": "\xEA", "^": "\xEE", "`": "\xF4", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xFB" }, t7.CHARSETS.K = { "@": "\xA7", "[": "\xC4", "\\": "\xD6", "]": "\xDC", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xDF" }, t7.CHARSETS.Y = { "#": "\xA3", "@": "\xA7", "[": "\xB0", "\\": "\xE7", "]": "\xE9", "`": "\xF9", "{": "\xE0", "|": "\xF2", "}": "\xE8", "~": "\xEC" }, t7.CHARSETS.E = t7.CHARSETS[6] = { "@": "\xC4", "[": "\xC6", "\\": "\xD8", "]": "\xC5", "^": "\xDC", "`": "\xE4", "{": "\xE6", "|": "\xF8", "}": "\xE5", "~": "\xFC" }, t7.CHARSETS.Z = { "#": "\xA3", "@": "\xA7", "[": "\xA1", "\\": "\xD1", "]": "\xBF", "{": "\xB0", "|": "\xF1", "}": "\xE7" }, t7.CHARSETS.H = t7.CHARSETS[7] = { "@": "\xC9", "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" }, t7.CHARSETS["="] = { "#": "\xF9", "@": "\xE0", "[": "\xE9", "\\": "\xE7", "]": "\xEA", "^": "\xEE", _: "\xE8", "`": "\xF4", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xFB" };
      }, 2584: (e11, t7) => {
        var i9, s5, r11;
        Object.defineProperty(t7, "__esModule", { value: true }), t7.C1_ESCAPED = t7.C1 = t7.C0 = void 0, (function(e12) {
          e12.NUL = "\0", e12.SOH = "", e12.STX = "", e12.ETX = "", e12.EOT = "", e12.ENQ = "", e12.ACK = "", e12.BEL = "\x07", e12.BS = "\b", e12.HT = "	", e12.LF = "\n", e12.VT = "\v", e12.FF = "\f", e12.CR = "\r", e12.SO = "", e12.SI = "", e12.DLE = "", e12.DC1 = "", e12.DC2 = "", e12.DC3 = "", e12.DC4 = "", e12.NAK = "", e12.SYN = "", e12.ETB = "", e12.CAN = "", e12.EM = "", e12.SUB = "", e12.ESC = "\x1B", e12.FS = "", e12.GS = "", e12.RS = "", e12.US = "", e12.SP = " ", e12.DEL = "\x7F";
        })(i9 || (t7.C0 = i9 = {})), (function(e12) {
          e12.PAD = "\x80", e12.HOP = "\x81", e12.BPH = "\x82", e12.NBH = "\x83", e12.IND = "\x84", e12.NEL = "\x85", e12.SSA = "\x86", e12.ESA = "\x87", e12.HTS = "\x88", e12.HTJ = "\x89", e12.VTS = "\x8A", e12.PLD = "\x8B", e12.PLU = "\x8C", e12.RI = "\x8D", e12.SS2 = "\x8E", e12.SS3 = "\x8F", e12.DCS = "\x90", e12.PU1 = "\x91", e12.PU2 = "\x92", e12.STS = "\x93", e12.CCH = "\x94", e12.MW = "\x95", e12.SPA = "\x96", e12.EPA = "\x97", e12.SOS = "\x98", e12.SGCI = "\x99", e12.SCI = "\x9A", e12.CSI = "\x9B", e12.ST = "\x9C", e12.OSC = "\x9D", e12.PM = "\x9E", e12.APC = "\x9F";
        })(s5 || (t7.C1 = s5 = {})), (function(e12) {
          e12.ST = `${i9.ESC}\\`;
        })(r11 || (t7.C1_ESCAPED = r11 = {}));
      }, 7399: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.evaluateKeyboardEvent = void 0;
        const s5 = i9(2584), r11 = { 48: ["0", ")"], 49: ["1", "!"], 50: ["2", "@"], 51: ["3", "#"], 52: ["4", "$"], 53: ["5", "%"], 54: ["6", "^"], 55: ["7", "&"], 56: ["8", "*"], 57: ["9", "("], 186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"], 191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", '"'] };
        t7.evaluateKeyboardEvent = function(e12, t8, i10, n6) {
          const o10 = { type: 0, cancel: false, key: void 0 }, a4 = (e12.shiftKey ? 1 : 0) | (e12.altKey ? 2 : 0) | (e12.ctrlKey ? 4 : 0) | (e12.metaKey ? 8 : 0);
          switch (e12.keyCode) {
            case 0:
              "UIKeyInputUpArrow" === e12.key ? o10.key = t8 ? s5.C0.ESC + "OA" : s5.C0.ESC + "[A" : "UIKeyInputLeftArrow" === e12.key ? o10.key = t8 ? s5.C0.ESC + "OD" : s5.C0.ESC + "[D" : "UIKeyInputRightArrow" === e12.key ? o10.key = t8 ? s5.C0.ESC + "OC" : s5.C0.ESC + "[C" : "UIKeyInputDownArrow" === e12.key && (o10.key = t8 ? s5.C0.ESC + "OB" : s5.C0.ESC + "[B");
              break;
            case 8:
              if (e12.altKey) {
                o10.key = s5.C0.ESC + s5.C0.DEL;
                break;
              }
              o10.key = s5.C0.DEL;
              break;
            case 9:
              if (e12.shiftKey) {
                o10.key = s5.C0.ESC + "[Z";
                break;
              }
              o10.key = s5.C0.HT, o10.cancel = true;
              break;
            case 13:
              o10.key = e12.altKey ? s5.C0.ESC + s5.C0.CR : s5.C0.CR, o10.cancel = true;
              break;
            case 27:
              o10.key = s5.C0.ESC, e12.altKey && (o10.key = s5.C0.ESC + s5.C0.ESC), o10.cancel = true;
              break;
            case 37:
              if (e12.metaKey) break;
              a4 ? (o10.key = s5.C0.ESC + "[1;" + (a4 + 1) + "D", o10.key === s5.C0.ESC + "[1;3D" && (o10.key = s5.C0.ESC + (i10 ? "b" : "[1;5D"))) : o10.key = t8 ? s5.C0.ESC + "OD" : s5.C0.ESC + "[D";
              break;
            case 39:
              if (e12.metaKey) break;
              a4 ? (o10.key = s5.C0.ESC + "[1;" + (a4 + 1) + "C", o10.key === s5.C0.ESC + "[1;3C" && (o10.key = s5.C0.ESC + (i10 ? "f" : "[1;5C"))) : o10.key = t8 ? s5.C0.ESC + "OC" : s5.C0.ESC + "[C";
              break;
            case 38:
              if (e12.metaKey) break;
              a4 ? (o10.key = s5.C0.ESC + "[1;" + (a4 + 1) + "A", i10 || o10.key !== s5.C0.ESC + "[1;3A" || (o10.key = s5.C0.ESC + "[1;5A")) : o10.key = t8 ? s5.C0.ESC + "OA" : s5.C0.ESC + "[A";
              break;
            case 40:
              if (e12.metaKey) break;
              a4 ? (o10.key = s5.C0.ESC + "[1;" + (a4 + 1) + "B", i10 || o10.key !== s5.C0.ESC + "[1;3B" || (o10.key = s5.C0.ESC + "[1;5B")) : o10.key = t8 ? s5.C0.ESC + "OB" : s5.C0.ESC + "[B";
              break;
            case 45:
              e12.shiftKey || e12.ctrlKey || (o10.key = s5.C0.ESC + "[2~");
              break;
            case 46:
              o10.key = a4 ? s5.C0.ESC + "[3;" + (a4 + 1) + "~" : s5.C0.ESC + "[3~";
              break;
            case 36:
              o10.key = a4 ? s5.C0.ESC + "[1;" + (a4 + 1) + "H" : t8 ? s5.C0.ESC + "OH" : s5.C0.ESC + "[H";
              break;
            case 35:
              o10.key = a4 ? s5.C0.ESC + "[1;" + (a4 + 1) + "F" : t8 ? s5.C0.ESC + "OF" : s5.C0.ESC + "[F";
              break;
            case 33:
              e12.shiftKey ? o10.type = 2 : e12.ctrlKey ? o10.key = s5.C0.ESC + "[5;" + (a4 + 1) + "~" : o10.key = s5.C0.ESC + "[5~";
              break;
            case 34:
              e12.shiftKey ? o10.type = 3 : e12.ctrlKey ? o10.key = s5.C0.ESC + "[6;" + (a4 + 1) + "~" : o10.key = s5.C0.ESC + "[6~";
              break;
            case 112:
              o10.key = a4 ? s5.C0.ESC + "[1;" + (a4 + 1) + "P" : s5.C0.ESC + "OP";
              break;
            case 113:
              o10.key = a4 ? s5.C0.ESC + "[1;" + (a4 + 1) + "Q" : s5.C0.ESC + "OQ";
              break;
            case 114:
              o10.key = a4 ? s5.C0.ESC + "[1;" + (a4 + 1) + "R" : s5.C0.ESC + "OR";
              break;
            case 115:
              o10.key = a4 ? s5.C0.ESC + "[1;" + (a4 + 1) + "S" : s5.C0.ESC + "OS";
              break;
            case 116:
              o10.key = a4 ? s5.C0.ESC + "[15;" + (a4 + 1) + "~" : s5.C0.ESC + "[15~";
              break;
            case 117:
              o10.key = a4 ? s5.C0.ESC + "[17;" + (a4 + 1) + "~" : s5.C0.ESC + "[17~";
              break;
            case 118:
              o10.key = a4 ? s5.C0.ESC + "[18;" + (a4 + 1) + "~" : s5.C0.ESC + "[18~";
              break;
            case 119:
              o10.key = a4 ? s5.C0.ESC + "[19;" + (a4 + 1) + "~" : s5.C0.ESC + "[19~";
              break;
            case 120:
              o10.key = a4 ? s5.C0.ESC + "[20;" + (a4 + 1) + "~" : s5.C0.ESC + "[20~";
              break;
            case 121:
              o10.key = a4 ? s5.C0.ESC + "[21;" + (a4 + 1) + "~" : s5.C0.ESC + "[21~";
              break;
            case 122:
              o10.key = a4 ? s5.C0.ESC + "[23;" + (a4 + 1) + "~" : s5.C0.ESC + "[23~";
              break;
            case 123:
              o10.key = a4 ? s5.C0.ESC + "[24;" + (a4 + 1) + "~" : s5.C0.ESC + "[24~";
              break;
            default:
              if (!e12.ctrlKey || e12.shiftKey || e12.altKey || e12.metaKey) if (i10 && !n6 || !e12.altKey || e12.metaKey) !i10 || e12.altKey || e12.ctrlKey || e12.shiftKey || !e12.metaKey ? e12.key && !e12.ctrlKey && !e12.altKey && !e12.metaKey && e12.keyCode >= 48 && 1 === e12.key.length ? o10.key = e12.key : e12.key && e12.ctrlKey && ("_" === e12.key && (o10.key = s5.C0.US), "@" === e12.key && (o10.key = s5.C0.NUL)) : 65 === e12.keyCode && (o10.type = 1);
              else {
                const t9 = r11[e12.keyCode], i11 = null == t9 ? void 0 : t9[e12.shiftKey ? 1 : 0];
                if (i11) o10.key = s5.C0.ESC + i11;
                else if (e12.keyCode >= 65 && e12.keyCode <= 90) {
                  const t10 = e12.ctrlKey ? e12.keyCode - 64 : e12.keyCode + 32;
                  let i12 = String.fromCharCode(t10);
                  e12.shiftKey && (i12 = i12.toUpperCase()), o10.key = s5.C0.ESC + i12;
                } else if (32 === e12.keyCode) o10.key = s5.C0.ESC + (e12.ctrlKey ? s5.C0.NUL : " ");
                else if ("Dead" === e12.key && e12.code.startsWith("Key")) {
                  let t10 = e12.code.slice(3, 4);
                  e12.shiftKey || (t10 = t10.toLowerCase()), o10.key = s5.C0.ESC + t10, o10.cancel = true;
                }
              }
              else e12.keyCode >= 65 && e12.keyCode <= 90 ? o10.key = String.fromCharCode(e12.keyCode - 64) : 32 === e12.keyCode ? o10.key = s5.C0.NUL : e12.keyCode >= 51 && e12.keyCode <= 55 ? o10.key = String.fromCharCode(e12.keyCode - 51 + 27) : 56 === e12.keyCode ? o10.key = s5.C0.DEL : 219 === e12.keyCode ? o10.key = s5.C0.ESC : 220 === e12.keyCode ? o10.key = s5.C0.FS : 221 === e12.keyCode && (o10.key = s5.C0.GS);
          }
          return o10;
        };
      }, 482: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Utf8ToUtf32 = t7.StringToUtf32 = t7.utf32ToString = t7.stringFromCodePoint = void 0, t7.stringFromCodePoint = function(e12) {
          return e12 > 65535 ? (e12 -= 65536, String.fromCharCode(55296 + (e12 >> 10)) + String.fromCharCode(e12 % 1024 + 56320)) : String.fromCharCode(e12);
        }, t7.utf32ToString = function(e12, t8 = 0, i9 = e12.length) {
          let s5 = "";
          for (let r11 = t8; r11 < i9; ++r11) {
            let t9 = e12[r11];
            t9 > 65535 ? (t9 -= 65536, s5 += String.fromCharCode(55296 + (t9 >> 10)) + String.fromCharCode(t9 % 1024 + 56320)) : s5 += String.fromCharCode(t9);
          }
          return s5;
        }, t7.StringToUtf32 = class {
          constructor() {
            this._interim = 0;
          }
          clear() {
            this._interim = 0;
          }
          decode(e12, t8) {
            const i9 = e12.length;
            if (!i9) return 0;
            let s5 = 0, r11 = 0;
            if (this._interim) {
              const i10 = e12.charCodeAt(r11++);
              56320 <= i10 && i10 <= 57343 ? t8[s5++] = 1024 * (this._interim - 55296) + i10 - 56320 + 65536 : (t8[s5++] = this._interim, t8[s5++] = i10), this._interim = 0;
            }
            for (let n6 = r11; n6 < i9; ++n6) {
              const r12 = e12.charCodeAt(n6);
              if (55296 <= r12 && r12 <= 56319) {
                if (++n6 >= i9) return this._interim = r12, s5;
                const o10 = e12.charCodeAt(n6);
                56320 <= o10 && o10 <= 57343 ? t8[s5++] = 1024 * (r12 - 55296) + o10 - 56320 + 65536 : (t8[s5++] = r12, t8[s5++] = o10);
              } else 65279 !== r12 && (t8[s5++] = r12);
            }
            return s5;
          }
        }, t7.Utf8ToUtf32 = class {
          constructor() {
            this.interim = new Uint8Array(3);
          }
          clear() {
            this.interim.fill(0);
          }
          decode(e12, t8) {
            const i9 = e12.length;
            if (!i9) return 0;
            let s5, r11, n6, o10, a4 = 0, h4 = 0, c5 = 0;
            if (this.interim[0]) {
              let s6 = false, r12 = this.interim[0];
              r12 &= 192 == (224 & r12) ? 31 : 224 == (240 & r12) ? 15 : 7;
              let n7, o11 = 0;
              for (; (n7 = 63 & this.interim[++o11]) && o11 < 4; ) r12 <<= 6, r12 |= n7;
              const h5 = 192 == (224 & this.interim[0]) ? 2 : 224 == (240 & this.interim[0]) ? 3 : 4, l7 = h5 - o11;
              for (; c5 < l7; ) {
                if (c5 >= i9) return 0;
                if (n7 = e12[c5++], 128 != (192 & n7)) {
                  c5--, s6 = true;
                  break;
                }
                this.interim[o11++] = n7, r12 <<= 6, r12 |= 63 & n7;
              }
              s6 || (2 === h5 ? r12 < 128 ? c5-- : t8[a4++] = r12 : 3 === h5 ? r12 < 2048 || r12 >= 55296 && r12 <= 57343 || 65279 === r12 || (t8[a4++] = r12) : r12 < 65536 || r12 > 1114111 || (t8[a4++] = r12)), this.interim.fill(0);
            }
            const l6 = i9 - 4;
            let d3 = c5;
            for (; d3 < i9; ) {
              for (; !(!(d3 < l6) || 128 & (s5 = e12[d3]) || 128 & (r11 = e12[d3 + 1]) || 128 & (n6 = e12[d3 + 2]) || 128 & (o10 = e12[d3 + 3])); ) t8[a4++] = s5, t8[a4++] = r11, t8[a4++] = n6, t8[a4++] = o10, d3 += 4;
              if (s5 = e12[d3++], s5 < 128) t8[a4++] = s5;
              else if (192 == (224 & s5)) {
                if (d3 >= i9) return this.interim[0] = s5, a4;
                if (r11 = e12[d3++], 128 != (192 & r11)) {
                  d3--;
                  continue;
                }
                if (h4 = (31 & s5) << 6 | 63 & r11, h4 < 128) {
                  d3--;
                  continue;
                }
                t8[a4++] = h4;
              } else if (224 == (240 & s5)) {
                if (d3 >= i9) return this.interim[0] = s5, a4;
                if (r11 = e12[d3++], 128 != (192 & r11)) {
                  d3--;
                  continue;
                }
                if (d3 >= i9) return this.interim[0] = s5, this.interim[1] = r11, a4;
                if (n6 = e12[d3++], 128 != (192 & n6)) {
                  d3--;
                  continue;
                }
                if (h4 = (15 & s5) << 12 | (63 & r11) << 6 | 63 & n6, h4 < 2048 || h4 >= 55296 && h4 <= 57343 || 65279 === h4) continue;
                t8[a4++] = h4;
              } else if (240 == (248 & s5)) {
                if (d3 >= i9) return this.interim[0] = s5, a4;
                if (r11 = e12[d3++], 128 != (192 & r11)) {
                  d3--;
                  continue;
                }
                if (d3 >= i9) return this.interim[0] = s5, this.interim[1] = r11, a4;
                if (n6 = e12[d3++], 128 != (192 & n6)) {
                  d3--;
                  continue;
                }
                if (d3 >= i9) return this.interim[0] = s5, this.interim[1] = r11, this.interim[2] = n6, a4;
                if (o10 = e12[d3++], 128 != (192 & o10)) {
                  d3--;
                  continue;
                }
                if (h4 = (7 & s5) << 18 | (63 & r11) << 12 | (63 & n6) << 6 | 63 & o10, h4 < 65536 || h4 > 1114111) continue;
                t8[a4++] = h4;
              }
            }
            return a4;
          }
        };
      }, 225: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.UnicodeV6 = void 0;
        const i9 = [[768, 879], [1155, 1158], [1160, 1161], [1425, 1469], [1471, 1471], [1473, 1474], [1476, 1477], [1479, 1479], [1536, 1539], [1552, 1557], [1611, 1630], [1648, 1648], [1750, 1764], [1767, 1768], [1770, 1773], [1807, 1807], [1809, 1809], [1840, 1866], [1958, 1968], [2027, 2035], [2305, 2306], [2364, 2364], [2369, 2376], [2381, 2381], [2385, 2388], [2402, 2403], [2433, 2433], [2492, 2492], [2497, 2500], [2509, 2509], [2530, 2531], [2561, 2562], [2620, 2620], [2625, 2626], [2631, 2632], [2635, 2637], [2672, 2673], [2689, 2690], [2748, 2748], [2753, 2757], [2759, 2760], [2765, 2765], [2786, 2787], [2817, 2817], [2876, 2876], [2879, 2879], [2881, 2883], [2893, 2893], [2902, 2902], [2946, 2946], [3008, 3008], [3021, 3021], [3134, 3136], [3142, 3144], [3146, 3149], [3157, 3158], [3260, 3260], [3263, 3263], [3270, 3270], [3276, 3277], [3298, 3299], [3393, 3395], [3405, 3405], [3530, 3530], [3538, 3540], [3542, 3542], [3633, 3633], [3636, 3642], [3655, 3662], [3761, 3761], [3764, 3769], [3771, 3772], [3784, 3789], [3864, 3865], [3893, 3893], [3895, 3895], [3897, 3897], [3953, 3966], [3968, 3972], [3974, 3975], [3984, 3991], [3993, 4028], [4038, 4038], [4141, 4144], [4146, 4146], [4150, 4151], [4153, 4153], [4184, 4185], [4448, 4607], [4959, 4959], [5906, 5908], [5938, 5940], [5970, 5971], [6002, 6003], [6068, 6069], [6071, 6077], [6086, 6086], [6089, 6099], [6109, 6109], [6155, 6157], [6313, 6313], [6432, 6434], [6439, 6440], [6450, 6450], [6457, 6459], [6679, 6680], [6912, 6915], [6964, 6964], [6966, 6970], [6972, 6972], [6978, 6978], [7019, 7027], [7616, 7626], [7678, 7679], [8203, 8207], [8234, 8238], [8288, 8291], [8298, 8303], [8400, 8431], [12330, 12335], [12441, 12442], [43014, 43014], [43019, 43019], [43045, 43046], [64286, 64286], [65024, 65039], [65056, 65059], [65279, 65279], [65529, 65531]], s5 = [[68097, 68099], [68101, 68102], [68108, 68111], [68152, 68154], [68159, 68159], [119143, 119145], [119155, 119170], [119173, 119179], [119210, 119213], [119362, 119364], [917505, 917505], [917536, 917631], [917760, 917999]];
        let r11;
        t7.UnicodeV6 = class {
          constructor() {
            if (this.version = "6", !r11) {
              r11 = new Uint8Array(65536), r11.fill(1), r11[0] = 0, r11.fill(0, 1, 32), r11.fill(0, 127, 160), r11.fill(2, 4352, 4448), r11[9001] = 2, r11[9002] = 2, r11.fill(2, 11904, 42192), r11[12351] = 1, r11.fill(2, 44032, 55204), r11.fill(2, 63744, 64256), r11.fill(2, 65040, 65050), r11.fill(2, 65072, 65136), r11.fill(2, 65280, 65377), r11.fill(2, 65504, 65511);
              for (let e12 = 0; e12 < i9.length; ++e12) r11.fill(0, i9[e12][0], i9[e12][1] + 1);
            }
          }
          wcwidth(e12) {
            return e12 < 32 ? 0 : e12 < 127 ? 1 : e12 < 65536 ? r11[e12] : (function(e13, t8) {
              let i10, s6 = 0, r12 = t8.length - 1;
              if (e13 < t8[0][0] || e13 > t8[r12][1]) return false;
              for (; r12 >= s6; ) if (i10 = s6 + r12 >> 1, e13 > t8[i10][1]) s6 = i10 + 1;
              else {
                if (!(e13 < t8[i10][0])) return true;
                r12 = i10 - 1;
              }
              return false;
            })(e12, s5) ? 0 : e12 >= 131072 && e12 <= 196605 || e12 >= 196608 && e12 <= 262141 ? 2 : 1;
          }
        };
      }, 5981: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.WriteBuffer = void 0;
        const s5 = i9(8460), r11 = i9(844);
        class n6 extends r11.Disposable {
          constructor(e12) {
            super(), this._action = e12, this._writeBuffer = [], this._callbacks = [], this._pendingData = 0, this._bufferOffset = 0, this._isSyncWriting = false, this._syncCalls = 0, this._didUserInput = false, this._onWriteParsed = this.register(new s5.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event;
          }
          handleUserInput() {
            this._didUserInput = true;
          }
          writeSync(e12, t8) {
            if (void 0 !== t8 && this._syncCalls > t8) return void (this._syncCalls = 0);
            if (this._pendingData += e12.length, this._writeBuffer.push(e12), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting) return;
            let i10;
            for (this._isSyncWriting = true; i10 = this._writeBuffer.shift(); ) {
              this._action(i10);
              const e13 = this._callbacks.shift();
              e13 && e13();
            }
            this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = false, this._syncCalls = 0;
          }
          write(e12, t8) {
            if (this._pendingData > 5e7) throw new Error("write data discarded, use flow control to avoid losing data");
            if (!this._writeBuffer.length) {
              if (this._bufferOffset = 0, this._didUserInput) return this._didUserInput = false, this._pendingData += e12.length, this._writeBuffer.push(e12), this._callbacks.push(t8), void this._innerWrite();
              setTimeout((() => this._innerWrite()));
            }
            this._pendingData += e12.length, this._writeBuffer.push(e12), this._callbacks.push(t8);
          }
          _innerWrite(e12 = 0, t8 = true) {
            const i10 = e12 || Date.now();
            for (; this._writeBuffer.length > this._bufferOffset; ) {
              const e13 = this._writeBuffer[this._bufferOffset], s6 = this._action(e13, t8);
              if (s6) {
                const e14 = (e15) => Date.now() - i10 >= 12 ? setTimeout((() => this._innerWrite(0, e15))) : this._innerWrite(i10, e15);
                return void s6.catch(((e15) => (queueMicrotask((() => {
                  throw e15;
                })), Promise.resolve(false)))).then(e14);
              }
              const r12 = this._callbacks[this._bufferOffset];
              if (r12 && r12(), this._bufferOffset++, this._pendingData -= e13.length, Date.now() - i10 >= 12) break;
            }
            this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > 50 && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout((() => this._innerWrite()))) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
          }
        }
        t7.WriteBuffer = n6;
      }, 5941: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.toRgbString = t7.parseColor = void 0;
        const i9 = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/, s5 = /^[\da-f]+$/;
        function r11(e12, t8) {
          const i10 = e12.toString(16), s6 = i10.length < 2 ? "0" + i10 : i10;
          switch (t8) {
            case 4:
              return i10[0];
            case 8:
              return s6;
            case 12:
              return (s6 + s6).slice(0, 3);
            default:
              return s6 + s6;
          }
        }
        t7.parseColor = function(e12) {
          if (!e12) return;
          let t8 = e12.toLowerCase();
          if (0 === t8.indexOf("rgb:")) {
            t8 = t8.slice(4);
            const e13 = i9.exec(t8);
            if (e13) {
              const t9 = e13[1] ? 15 : e13[4] ? 255 : e13[7] ? 4095 : 65535;
              return [Math.round(parseInt(e13[1] || e13[4] || e13[7] || e13[10], 16) / t9 * 255), Math.round(parseInt(e13[2] || e13[5] || e13[8] || e13[11], 16) / t9 * 255), Math.round(parseInt(e13[3] || e13[6] || e13[9] || e13[12], 16) / t9 * 255)];
            }
          } else if (0 === t8.indexOf("#") && (t8 = t8.slice(1), s5.exec(t8) && [3, 6, 9, 12].includes(t8.length))) {
            const e13 = t8.length / 3, i10 = [0, 0, 0];
            for (let s6 = 0; s6 < 3; ++s6) {
              const r12 = parseInt(t8.slice(e13 * s6, e13 * s6 + e13), 16);
              i10[s6] = 1 === e13 ? r12 << 4 : 2 === e13 ? r12 : 3 === e13 ? r12 >> 4 : r12 >> 8;
            }
            return i10;
          }
        }, t7.toRgbString = function(e12, t8 = 16) {
          const [i10, s6, n6] = e12;
          return `rgb:${r11(i10, t8)}/${r11(s6, t8)}/${r11(n6, t8)}`;
        };
      }, 5770: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.PAYLOAD_LIMIT = void 0, t7.PAYLOAD_LIMIT = 1e7;
      }, 6351: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.DcsHandler = t7.DcsParser = void 0;
        const s5 = i9(482), r11 = i9(8742), n6 = i9(5770), o10 = [];
        t7.DcsParser = class {
          constructor() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._active = o10, this._ident = 0, this._handlerFb = () => {
            }, this._stack = { paused: false, loopPosition: 0, fallThrough: false };
          }
          dispose() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._active = o10;
          }
          registerHandler(e12, t8) {
            void 0 === this._handlers[e12] && (this._handlers[e12] = []);
            const i10 = this._handlers[e12];
            return i10.push(t8), { dispose: () => {
              const e13 = i10.indexOf(t8);
              -1 !== e13 && i10.splice(e13, 1);
            } };
          }
          clearHandler(e12) {
            this._handlers[e12] && delete this._handlers[e12];
          }
          setHandlerFallback(e12) {
            this._handlerFb = e12;
          }
          reset() {
            if (this._active.length) for (let e12 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e12 >= 0; --e12) this._active[e12].unhook(false);
            this._stack.paused = false, this._active = o10, this._ident = 0;
          }
          hook(e12, t8) {
            if (this.reset(), this._ident = e12, this._active = this._handlers[e12] || o10, this._active.length) for (let e13 = this._active.length - 1; e13 >= 0; e13--) this._active[e13].hook(t8);
            else this._handlerFb(this._ident, "HOOK", t8);
          }
          put(e12, t8, i10) {
            if (this._active.length) for (let s6 = this._active.length - 1; s6 >= 0; s6--) this._active[s6].put(e12, t8, i10);
            else this._handlerFb(this._ident, "PUT", (0, s5.utf32ToString)(e12, t8, i10));
          }
          unhook(e12, t8 = true) {
            if (this._active.length) {
              let i10 = false, s6 = this._active.length - 1, r12 = false;
              if (this._stack.paused && (s6 = this._stack.loopPosition - 1, i10 = t8, r12 = this._stack.fallThrough, this._stack.paused = false), !r12 && false === i10) {
                for (; s6 >= 0 && (i10 = this._active[s6].unhook(e12), true !== i10); s6--) if (i10 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s6, this._stack.fallThrough = false, i10;
                s6--;
              }
              for (; s6 >= 0; s6--) if (i10 = this._active[s6].unhook(false), i10 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s6, this._stack.fallThrough = true, i10;
            } else this._handlerFb(this._ident, "UNHOOK", e12);
            this._active = o10, this._ident = 0;
          }
        };
        const a4 = new r11.Params();
        a4.addParam(0), t7.DcsHandler = class {
          constructor(e12) {
            this._handler = e12, this._data = "", this._params = a4, this._hitLimit = false;
          }
          hook(e12) {
            this._params = e12.length > 1 || e12.params[0] ? e12.clone() : a4, this._data = "", this._hitLimit = false;
          }
          put(e12, t8, i10) {
            this._hitLimit || (this._data += (0, s5.utf32ToString)(e12, t8, i10), this._data.length > n6.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = true));
          }
          unhook(e12) {
            let t8 = false;
            if (this._hitLimit) t8 = false;
            else if (e12 && (t8 = this._handler(this._data, this._params), t8 instanceof Promise)) return t8.then(((e13) => (this._params = a4, this._data = "", this._hitLimit = false, e13)));
            return this._params = a4, this._data = "", this._hitLimit = false, t8;
          }
        };
      }, 2015: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.EscapeSequenceParser = t7.VT500_TRANSITION_TABLE = t7.TransitionTable = void 0;
        const s5 = i9(844), r11 = i9(8742), n6 = i9(6242), o10 = i9(6351);
        class a4 {
          constructor(e12) {
            this.table = new Uint8Array(e12);
          }
          setDefault(e12, t8) {
            this.table.fill(e12 << 4 | t8);
          }
          add(e12, t8, i10, s6) {
            this.table[t8 << 8 | e12] = i10 << 4 | s6;
          }
          addMany(e12, t8, i10, s6) {
            for (let r12 = 0; r12 < e12.length; r12++) this.table[t8 << 8 | e12[r12]] = i10 << 4 | s6;
          }
        }
        t7.TransitionTable = a4;
        const h4 = 160;
        t7.VT500_TRANSITION_TABLE = (function() {
          const e12 = new a4(4095), t8 = Array.apply(null, Array(256)).map(((e13, t9) => t9)), i10 = (e13, i11) => t8.slice(e13, i11), s6 = i10(32, 127), r12 = i10(0, 24);
          r12.push(25), r12.push.apply(r12, i10(28, 32));
          const n7 = i10(0, 14);
          let o11;
          for (o11 in e12.setDefault(1, 0), e12.addMany(s6, 0, 2, 0), n7) e12.addMany([24, 26, 153, 154], o11, 3, 0), e12.addMany(i10(128, 144), o11, 3, 0), e12.addMany(i10(144, 152), o11, 3, 0), e12.add(156, o11, 0, 0), e12.add(27, o11, 11, 1), e12.add(157, o11, 4, 8), e12.addMany([152, 158, 159], o11, 0, 7), e12.add(155, o11, 11, 3), e12.add(144, o11, 11, 9);
          return e12.addMany(r12, 0, 3, 0), e12.addMany(r12, 1, 3, 1), e12.add(127, 1, 0, 1), e12.addMany(r12, 8, 0, 8), e12.addMany(r12, 3, 3, 3), e12.add(127, 3, 0, 3), e12.addMany(r12, 4, 3, 4), e12.add(127, 4, 0, 4), e12.addMany(r12, 6, 3, 6), e12.addMany(r12, 5, 3, 5), e12.add(127, 5, 0, 5), e12.addMany(r12, 2, 3, 2), e12.add(127, 2, 0, 2), e12.add(93, 1, 4, 8), e12.addMany(s6, 8, 5, 8), e12.add(127, 8, 5, 8), e12.addMany([156, 27, 24, 26, 7], 8, 6, 0), e12.addMany(i10(28, 32), 8, 0, 8), e12.addMany([88, 94, 95], 1, 0, 7), e12.addMany(s6, 7, 0, 7), e12.addMany(r12, 7, 0, 7), e12.add(156, 7, 0, 0), e12.add(127, 7, 0, 7), e12.add(91, 1, 11, 3), e12.addMany(i10(64, 127), 3, 7, 0), e12.addMany(i10(48, 60), 3, 8, 4), e12.addMany([60, 61, 62, 63], 3, 9, 4), e12.addMany(i10(48, 60), 4, 8, 4), e12.addMany(i10(64, 127), 4, 7, 0), e12.addMany([60, 61, 62, 63], 4, 0, 6), e12.addMany(i10(32, 64), 6, 0, 6), e12.add(127, 6, 0, 6), e12.addMany(i10(64, 127), 6, 0, 0), e12.addMany(i10(32, 48), 3, 9, 5), e12.addMany(i10(32, 48), 5, 9, 5), e12.addMany(i10(48, 64), 5, 0, 6), e12.addMany(i10(64, 127), 5, 7, 0), e12.addMany(i10(32, 48), 4, 9, 5), e12.addMany(i10(32, 48), 1, 9, 2), e12.addMany(i10(32, 48), 2, 9, 2), e12.addMany(i10(48, 127), 2, 10, 0), e12.addMany(i10(48, 80), 1, 10, 0), e12.addMany(i10(81, 88), 1, 10, 0), e12.addMany([89, 90, 92], 1, 10, 0), e12.addMany(i10(96, 127), 1, 10, 0), e12.add(80, 1, 11, 9), e12.addMany(r12, 9, 0, 9), e12.add(127, 9, 0, 9), e12.addMany(i10(28, 32), 9, 0, 9), e12.addMany(i10(32, 48), 9, 9, 12), e12.addMany(i10(48, 60), 9, 8, 10), e12.addMany([60, 61, 62, 63], 9, 9, 10), e12.addMany(r12, 11, 0, 11), e12.addMany(i10(32, 128), 11, 0, 11), e12.addMany(i10(28, 32), 11, 0, 11), e12.addMany(r12, 10, 0, 10), e12.add(127, 10, 0, 10), e12.addMany(i10(28, 32), 10, 0, 10), e12.addMany(i10(48, 60), 10, 8, 10), e12.addMany([60, 61, 62, 63], 10, 0, 11), e12.addMany(i10(32, 48), 10, 9, 12), e12.addMany(r12, 12, 0, 12), e12.add(127, 12, 0, 12), e12.addMany(i10(28, 32), 12, 0, 12), e12.addMany(i10(32, 48), 12, 9, 12), e12.addMany(i10(48, 64), 12, 0, 11), e12.addMany(i10(64, 127), 12, 12, 13), e12.addMany(i10(64, 127), 10, 12, 13), e12.addMany(i10(64, 127), 9, 12, 13), e12.addMany(r12, 13, 13, 13), e12.addMany(s6, 13, 13, 13), e12.add(127, 13, 0, 13), e12.addMany([27, 156, 24, 26], 13, 14, 0), e12.add(h4, 0, 2, 0), e12.add(h4, 8, 5, 8), e12.add(h4, 6, 0, 6), e12.add(h4, 11, 0, 11), e12.add(h4, 13, 13, 13), e12;
        })();
        class c5 extends s5.Disposable {
          constructor(e12 = t7.VT500_TRANSITION_TABLE) {
            super(), this._transitions = e12, this._parseStack = { state: 0, handlers: [], handlerPos: 0, transition: 0, chunkPos: 0 }, this.initialState = 0, this.currentState = this.initialState, this._params = new r11.Params(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0, this._printHandlerFb = (e13, t8, i10) => {
            }, this._executeHandlerFb = (e13) => {
            }, this._csiHandlerFb = (e13, t8) => {
            }, this._escHandlerFb = (e13) => {
            }, this._errorHandlerFb = (e13) => e13, this._printHandler = this._printHandlerFb, this._executeHandlers = /* @__PURE__ */ Object.create(null), this._csiHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null), this.register((0, s5.toDisposable)((() => {
              this._csiHandlers = /* @__PURE__ */ Object.create(null), this._executeHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null);
            }))), this._oscParser = this.register(new n6.OscParser()), this._dcsParser = this.register(new o10.DcsParser()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, (() => true));
          }
          _identifier(e12, t8 = [64, 126]) {
            let i10 = 0;
            if (e12.prefix) {
              if (e12.prefix.length > 1) throw new Error("only one byte as prefix supported");
              if (i10 = e12.prefix.charCodeAt(0), i10 && 60 > i10 || i10 > 63) throw new Error("prefix must be in range 0x3c .. 0x3f");
            }
            if (e12.intermediates) {
              if (e12.intermediates.length > 2) throw new Error("only two bytes as intermediates are supported");
              for (let t9 = 0; t9 < e12.intermediates.length; ++t9) {
                const s7 = e12.intermediates.charCodeAt(t9);
                if (32 > s7 || s7 > 47) throw new Error("intermediate must be in range 0x20 .. 0x2f");
                i10 <<= 8, i10 |= s7;
              }
            }
            if (1 !== e12.final.length) throw new Error("final must be a single byte");
            const s6 = e12.final.charCodeAt(0);
            if (t8[0] > s6 || s6 > t8[1]) throw new Error(`final must be in range ${t8[0]} .. ${t8[1]}`);
            return i10 <<= 8, i10 |= s6, i10;
          }
          identToString(e12) {
            const t8 = [];
            for (; e12; ) t8.push(String.fromCharCode(255 & e12)), e12 >>= 8;
            return t8.reverse().join("");
          }
          setPrintHandler(e12) {
            this._printHandler = e12;
          }
          clearPrintHandler() {
            this._printHandler = this._printHandlerFb;
          }
          registerEscHandler(e12, t8) {
            const i10 = this._identifier(e12, [48, 126]);
            void 0 === this._escHandlers[i10] && (this._escHandlers[i10] = []);
            const s6 = this._escHandlers[i10];
            return s6.push(t8), { dispose: () => {
              const e13 = s6.indexOf(t8);
              -1 !== e13 && s6.splice(e13, 1);
            } };
          }
          clearEscHandler(e12) {
            this._escHandlers[this._identifier(e12, [48, 126])] && delete this._escHandlers[this._identifier(e12, [48, 126])];
          }
          setEscHandlerFallback(e12) {
            this._escHandlerFb = e12;
          }
          setExecuteHandler(e12, t8) {
            this._executeHandlers[e12.charCodeAt(0)] = t8;
          }
          clearExecuteHandler(e12) {
            this._executeHandlers[e12.charCodeAt(0)] && delete this._executeHandlers[e12.charCodeAt(0)];
          }
          setExecuteHandlerFallback(e12) {
            this._executeHandlerFb = e12;
          }
          registerCsiHandler(e12, t8) {
            const i10 = this._identifier(e12);
            void 0 === this._csiHandlers[i10] && (this._csiHandlers[i10] = []);
            const s6 = this._csiHandlers[i10];
            return s6.push(t8), { dispose: () => {
              const e13 = s6.indexOf(t8);
              -1 !== e13 && s6.splice(e13, 1);
            } };
          }
          clearCsiHandler(e12) {
            this._csiHandlers[this._identifier(e12)] && delete this._csiHandlers[this._identifier(e12)];
          }
          setCsiHandlerFallback(e12) {
            this._csiHandlerFb = e12;
          }
          registerDcsHandler(e12, t8) {
            return this._dcsParser.registerHandler(this._identifier(e12), t8);
          }
          clearDcsHandler(e12) {
            this._dcsParser.clearHandler(this._identifier(e12));
          }
          setDcsHandlerFallback(e12) {
            this._dcsParser.setHandlerFallback(e12);
          }
          registerOscHandler(e12, t8) {
            return this._oscParser.registerHandler(e12, t8);
          }
          clearOscHandler(e12) {
            this._oscParser.clearHandler(e12);
          }
          setOscHandlerFallback(e12) {
            this._oscParser.setHandlerFallback(e12);
          }
          setErrorHandler(e12) {
            this._errorHandler = e12;
          }
          clearErrorHandler() {
            this._errorHandler = this._errorHandlerFb;
          }
          reset() {
            this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0, 0 !== this._parseStack.state && (this._parseStack.state = 2, this._parseStack.handlers = []);
          }
          _preserveStack(e12, t8, i10, s6, r12) {
            this._parseStack.state = e12, this._parseStack.handlers = t8, this._parseStack.handlerPos = i10, this._parseStack.transition = s6, this._parseStack.chunkPos = r12;
          }
          parse(e12, t8, i10) {
            let s6, r12 = 0, n7 = 0, o11 = 0;
            if (this._parseStack.state) if (2 === this._parseStack.state) this._parseStack.state = 0, o11 = this._parseStack.chunkPos + 1;
            else {
              if (void 0 === i10 || 1 === this._parseStack.state) throw this._parseStack.state = 1, new Error("improper continuation due to previous async handler, giving up parsing");
              const t9 = this._parseStack.handlers;
              let n8 = this._parseStack.handlerPos - 1;
              switch (this._parseStack.state) {
                case 3:
                  if (false === i10 && n8 > -1) {
                    for (; n8 >= 0 && (s6 = t9[n8](this._params), true !== s6); n8--) if (s6 instanceof Promise) return this._parseStack.handlerPos = n8, s6;
                  }
                  this._parseStack.handlers = [];
                  break;
                case 4:
                  if (false === i10 && n8 > -1) {
                    for (; n8 >= 0 && (s6 = t9[n8](), true !== s6); n8--) if (s6 instanceof Promise) return this._parseStack.handlerPos = n8, s6;
                  }
                  this._parseStack.handlers = [];
                  break;
                case 6:
                  if (r12 = e12[this._parseStack.chunkPos], s6 = this._dcsParser.unhook(24 !== r12 && 26 !== r12, i10), s6) return s6;
                  27 === r12 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
                  break;
                case 5:
                  if (r12 = e12[this._parseStack.chunkPos], s6 = this._oscParser.end(24 !== r12 && 26 !== r12, i10), s6) return s6;
                  27 === r12 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
              }
              this._parseStack.state = 0, o11 = this._parseStack.chunkPos + 1, this.precedingCodepoint = 0, this.currentState = 15 & this._parseStack.transition;
            }
            for (let i11 = o11; i11 < t8; ++i11) {
              switch (r12 = e12[i11], n7 = this._transitions.table[this.currentState << 8 | (r12 < 160 ? r12 : h4)], n7 >> 4) {
                case 2:
                  for (let s7 = i11 + 1; ; ++s7) {
                    if (s7 >= t8 || (r12 = e12[s7]) < 32 || r12 > 126 && r12 < h4) {
                      this._printHandler(e12, i11, s7), i11 = s7 - 1;
                      break;
                    }
                    if (++s7 >= t8 || (r12 = e12[s7]) < 32 || r12 > 126 && r12 < h4) {
                      this._printHandler(e12, i11, s7), i11 = s7 - 1;
                      break;
                    }
                    if (++s7 >= t8 || (r12 = e12[s7]) < 32 || r12 > 126 && r12 < h4) {
                      this._printHandler(e12, i11, s7), i11 = s7 - 1;
                      break;
                    }
                    if (++s7 >= t8 || (r12 = e12[s7]) < 32 || r12 > 126 && r12 < h4) {
                      this._printHandler(e12, i11, s7), i11 = s7 - 1;
                      break;
                    }
                  }
                  break;
                case 3:
                  this._executeHandlers[r12] ? this._executeHandlers[r12]() : this._executeHandlerFb(r12), this.precedingCodepoint = 0;
                  break;
                case 0:
                  break;
                case 1:
                  if (this._errorHandler({ position: i11, code: r12, currentState: this.currentState, collect: this._collect, params: this._params, abort: false }).abort) return;
                  break;
                case 7:
                  const o12 = this._csiHandlers[this._collect << 8 | r12];
                  let a5 = o12 ? o12.length - 1 : -1;
                  for (; a5 >= 0 && (s6 = o12[a5](this._params), true !== s6); a5--) if (s6 instanceof Promise) return this._preserveStack(3, o12, a5, n7, i11), s6;
                  a5 < 0 && this._csiHandlerFb(this._collect << 8 | r12, this._params), this.precedingCodepoint = 0;
                  break;
                case 8:
                  do {
                    switch (r12) {
                      case 59:
                        this._params.addParam(0);
                        break;
                      case 58:
                        this._params.addSubParam(-1);
                        break;
                      default:
                        this._params.addDigit(r12 - 48);
                    }
                  } while (++i11 < t8 && (r12 = e12[i11]) > 47 && r12 < 60);
                  i11--;
                  break;
                case 9:
                  this._collect <<= 8, this._collect |= r12;
                  break;
                case 10:
                  const c6 = this._escHandlers[this._collect << 8 | r12];
                  let l6 = c6 ? c6.length - 1 : -1;
                  for (; l6 >= 0 && (s6 = c6[l6](), true !== s6); l6--) if (s6 instanceof Promise) return this._preserveStack(4, c6, l6, n7, i11), s6;
                  l6 < 0 && this._escHandlerFb(this._collect << 8 | r12), this.precedingCodepoint = 0;
                  break;
                case 11:
                  this._params.reset(), this._params.addParam(0), this._collect = 0;
                  break;
                case 12:
                  this._dcsParser.hook(this._collect << 8 | r12, this._params);
                  break;
                case 13:
                  for (let s7 = i11 + 1; ; ++s7) if (s7 >= t8 || 24 === (r12 = e12[s7]) || 26 === r12 || 27 === r12 || r12 > 127 && r12 < h4) {
                    this._dcsParser.put(e12, i11, s7), i11 = s7 - 1;
                    break;
                  }
                  break;
                case 14:
                  if (s6 = this._dcsParser.unhook(24 !== r12 && 26 !== r12), s6) return this._preserveStack(6, [], 0, n7, i11), s6;
                  27 === r12 && (n7 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0;
                  break;
                case 4:
                  this._oscParser.start();
                  break;
                case 5:
                  for (let s7 = i11 + 1; ; s7++) if (s7 >= t8 || (r12 = e12[s7]) < 32 || r12 > 127 && r12 < h4) {
                    this._oscParser.put(e12, i11, s7), i11 = s7 - 1;
                    break;
                  }
                  break;
                case 6:
                  if (s6 = this._oscParser.end(24 !== r12 && 26 !== r12), s6) return this._preserveStack(5, [], 0, n7, i11), s6;
                  27 === r12 && (n7 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingCodepoint = 0;
              }
              this.currentState = 15 & n7;
            }
          }
        }
        t7.EscapeSequenceParser = c5;
      }, 6242: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.OscHandler = t7.OscParser = void 0;
        const s5 = i9(5770), r11 = i9(482), n6 = [];
        t7.OscParser = class {
          constructor() {
            this._state = 0, this._active = n6, this._id = -1, this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._stack = { paused: false, loopPosition: 0, fallThrough: false };
          }
          registerHandler(e12, t8) {
            void 0 === this._handlers[e12] && (this._handlers[e12] = []);
            const i10 = this._handlers[e12];
            return i10.push(t8), { dispose: () => {
              const e13 = i10.indexOf(t8);
              -1 !== e13 && i10.splice(e13, 1);
            } };
          }
          clearHandler(e12) {
            this._handlers[e12] && delete this._handlers[e12];
          }
          setHandlerFallback(e12) {
            this._handlerFb = e12;
          }
          dispose() {
            this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
            }, this._active = n6;
          }
          reset() {
            if (2 === this._state) for (let e12 = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e12 >= 0; --e12) this._active[e12].end(false);
            this._stack.paused = false, this._active = n6, this._id = -1, this._state = 0;
          }
          _start() {
            if (this._active = this._handlers[this._id] || n6, this._active.length) for (let e12 = this._active.length - 1; e12 >= 0; e12--) this._active[e12].start();
            else this._handlerFb(this._id, "START");
          }
          _put(e12, t8, i10) {
            if (this._active.length) for (let s6 = this._active.length - 1; s6 >= 0; s6--) this._active[s6].put(e12, t8, i10);
            else this._handlerFb(this._id, "PUT", (0, r11.utf32ToString)(e12, t8, i10));
          }
          start() {
            this.reset(), this._state = 1;
          }
          put(e12, t8, i10) {
            if (3 !== this._state) {
              if (1 === this._state) for (; t8 < i10; ) {
                const i11 = e12[t8++];
                if (59 === i11) {
                  this._state = 2, this._start();
                  break;
                }
                if (i11 < 48 || 57 < i11) return void (this._state = 3);
                -1 === this._id && (this._id = 0), this._id = 10 * this._id + i11 - 48;
              }
              2 === this._state && i10 - t8 > 0 && this._put(e12, t8, i10);
            }
          }
          end(e12, t8 = true) {
            if (0 !== this._state) {
              if (3 !== this._state) if (1 === this._state && this._start(), this._active.length) {
                let i10 = false, s6 = this._active.length - 1, r12 = false;
                if (this._stack.paused && (s6 = this._stack.loopPosition - 1, i10 = t8, r12 = this._stack.fallThrough, this._stack.paused = false), !r12 && false === i10) {
                  for (; s6 >= 0 && (i10 = this._active[s6].end(e12), true !== i10); s6--) if (i10 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s6, this._stack.fallThrough = false, i10;
                  s6--;
                }
                for (; s6 >= 0; s6--) if (i10 = this._active[s6].end(false), i10 instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = s6, this._stack.fallThrough = true, i10;
              } else this._handlerFb(this._id, "END", e12);
              this._active = n6, this._id = -1, this._state = 0;
            }
          }
        }, t7.OscHandler = class {
          constructor(e12) {
            this._handler = e12, this._data = "", this._hitLimit = false;
          }
          start() {
            this._data = "", this._hitLimit = false;
          }
          put(e12, t8, i10) {
            this._hitLimit || (this._data += (0, r11.utf32ToString)(e12, t8, i10), this._data.length > s5.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = true));
          }
          end(e12) {
            let t8 = false;
            if (this._hitLimit) t8 = false;
            else if (e12 && (t8 = this._handler(this._data), t8 instanceof Promise)) return t8.then(((e13) => (this._data = "", this._hitLimit = false, e13)));
            return this._data = "", this._hitLimit = false, t8;
          }
        };
      }, 8742: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.Params = void 0;
        const i9 = 2147483647;
        class s5 {
          static fromArray(e12) {
            const t8 = new s5();
            if (!e12.length) return t8;
            for (let i10 = Array.isArray(e12[0]) ? 1 : 0; i10 < e12.length; ++i10) {
              const s6 = e12[i10];
              if (Array.isArray(s6)) for (let e13 = 0; e13 < s6.length; ++e13) t8.addSubParam(s6[e13]);
              else t8.addParam(s6);
            }
            return t8;
          }
          constructor(e12 = 32, t8 = 32) {
            if (this.maxLength = e12, this.maxSubParamsLength = t8, t8 > 256) throw new Error("maxSubParamsLength must not be greater than 256");
            this.params = new Int32Array(e12), this.length = 0, this._subParams = new Int32Array(t8), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(e12), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
          }
          clone() {
            const e12 = new s5(this.maxLength, this.maxSubParamsLength);
            return e12.params.set(this.params), e12.length = this.length, e12._subParams.set(this._subParams), e12._subParamsLength = this._subParamsLength, e12._subParamsIdx.set(this._subParamsIdx), e12._rejectDigits = this._rejectDigits, e12._rejectSubDigits = this._rejectSubDigits, e12._digitIsSub = this._digitIsSub, e12;
          }
          toArray() {
            const e12 = [];
            for (let t8 = 0; t8 < this.length; ++t8) {
              e12.push(this.params[t8]);
              const i10 = this._subParamsIdx[t8] >> 8, s6 = 255 & this._subParamsIdx[t8];
              s6 - i10 > 0 && e12.push(Array.prototype.slice.call(this._subParams, i10, s6));
            }
            return e12;
          }
          reset() {
            this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
          }
          addParam(e12) {
            if (this._digitIsSub = false, this.length >= this.maxLength) this._rejectDigits = true;
            else {
              if (e12 < -1) throw new Error("values lesser than -1 are not allowed");
              this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = e12 > i9 ? i9 : e12;
            }
          }
          addSubParam(e12) {
            if (this._digitIsSub = true, this.length) if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) this._rejectSubDigits = true;
            else {
              if (e12 < -1) throw new Error("values lesser than -1 are not allowed");
              this._subParams[this._subParamsLength++] = e12 > i9 ? i9 : e12, this._subParamsIdx[this.length - 1]++;
            }
          }
          hasSubParams(e12) {
            return (255 & this._subParamsIdx[e12]) - (this._subParamsIdx[e12] >> 8) > 0;
          }
          getSubParams(e12) {
            const t8 = this._subParamsIdx[e12] >> 8, i10 = 255 & this._subParamsIdx[e12];
            return i10 - t8 > 0 ? this._subParams.subarray(t8, i10) : null;
          }
          getSubParamsAll() {
            const e12 = {};
            for (let t8 = 0; t8 < this.length; ++t8) {
              const i10 = this._subParamsIdx[t8] >> 8, s6 = 255 & this._subParamsIdx[t8];
              s6 - i10 > 0 && (e12[t8] = this._subParams.slice(i10, s6));
            }
            return e12;
          }
          addDigit(e12) {
            let t8;
            if (this._rejectDigits || !(t8 = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
            const s6 = this._digitIsSub ? this._subParams : this.params, r11 = s6[t8 - 1];
            s6[t8 - 1] = ~r11 ? Math.min(10 * r11 + e12, i9) : e12;
          }
        }
        t7.Params = s5;
      }, 5741: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.AddonManager = void 0, t7.AddonManager = class {
          constructor() {
            this._addons = [];
          }
          dispose() {
            for (let e12 = this._addons.length - 1; e12 >= 0; e12--) this._addons[e12].instance.dispose();
          }
          loadAddon(e12, t8) {
            const i9 = { instance: t8, dispose: t8.dispose, isDisposed: false };
            this._addons.push(i9), t8.dispose = () => this._wrappedAddonDispose(i9), t8.activate(e12);
          }
          _wrappedAddonDispose(e12) {
            if (e12.isDisposed) return;
            let t8 = -1;
            for (let i9 = 0; i9 < this._addons.length; i9++) if (this._addons[i9] === e12) {
              t8 = i9;
              break;
            }
            if (-1 === t8) throw new Error("Could not dispose an addon that has not been loaded");
            e12.isDisposed = true, e12.dispose.apply(e12.instance), this._addons.splice(t8, 1);
          }
        };
      }, 8771: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferApiView = void 0;
        const s5 = i9(3785), r11 = i9(511);
        t7.BufferApiView = class {
          constructor(e12, t8) {
            this._buffer = e12, this.type = t8;
          }
          init(e12) {
            return this._buffer = e12, this;
          }
          get cursorY() {
            return this._buffer.y;
          }
          get cursorX() {
            return this._buffer.x;
          }
          get viewportY() {
            return this._buffer.ydisp;
          }
          get baseY() {
            return this._buffer.ybase;
          }
          get length() {
            return this._buffer.lines.length;
          }
          getLine(e12) {
            const t8 = this._buffer.lines.get(e12);
            if (t8) return new s5.BufferLineApiView(t8);
          }
          getNullCell() {
            return new r11.CellData();
          }
        };
      }, 3785: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferLineApiView = void 0;
        const s5 = i9(511);
        t7.BufferLineApiView = class {
          constructor(e12) {
            this._line = e12;
          }
          get isWrapped() {
            return this._line.isWrapped;
          }
          get length() {
            return this._line.length;
          }
          getCell(e12, t8) {
            if (!(e12 < 0 || e12 >= this._line.length)) return t8 ? (this._line.loadCell(e12, t8), t8) : this._line.loadCell(e12, new s5.CellData());
          }
          translateToString(e12, t8, i10) {
            return this._line.translateToString(e12, t8, i10);
          }
        };
      }, 8285: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferNamespaceApi = void 0;
        const s5 = i9(8771), r11 = i9(8460), n6 = i9(844);
        class o10 extends n6.Disposable {
          constructor(e12) {
            super(), this._core = e12, this._onBufferChange = this.register(new r11.EventEmitter()), this.onBufferChange = this._onBufferChange.event, this._normal = new s5.BufferApiView(this._core.buffers.normal, "normal"), this._alternate = new s5.BufferApiView(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate((() => this._onBufferChange.fire(this.active)));
          }
          get active() {
            if (this._core.buffers.active === this._core.buffers.normal) return this.normal;
            if (this._core.buffers.active === this._core.buffers.alt) return this.alternate;
            throw new Error("Active buffer is neither normal nor alternate");
          }
          get normal() {
            return this._normal.init(this._core.buffers.normal);
          }
          get alternate() {
            return this._alternate.init(this._core.buffers.alt);
          }
        }
        t7.BufferNamespaceApi = o10;
      }, 7975: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.ParserApi = void 0, t7.ParserApi = class {
          constructor(e12) {
            this._core = e12;
          }
          registerCsiHandler(e12, t8) {
            return this._core.registerCsiHandler(e12, ((e13) => t8(e13.toArray())));
          }
          addCsiHandler(e12, t8) {
            return this.registerCsiHandler(e12, t8);
          }
          registerDcsHandler(e12, t8) {
            return this._core.registerDcsHandler(e12, ((e13, i9) => t8(e13, i9.toArray())));
          }
          addDcsHandler(e12, t8) {
            return this.registerDcsHandler(e12, t8);
          }
          registerEscHandler(e12, t8) {
            return this._core.registerEscHandler(e12, t8);
          }
          addEscHandler(e12, t8) {
            return this.registerEscHandler(e12, t8);
          }
          registerOscHandler(e12, t8) {
            return this._core.registerOscHandler(e12, t8);
          }
          addOscHandler(e12, t8) {
            return this.registerOscHandler(e12, t8);
          }
        };
      }, 7090: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.UnicodeApi = void 0, t7.UnicodeApi = class {
          constructor(e12) {
            this._core = e12;
          }
          register(e12) {
            this._core.unicodeService.register(e12);
          }
          get versions() {
            return this._core.unicodeService.versions;
          }
          get activeVersion() {
            return this._core.unicodeService.activeVersion;
          }
          set activeVersion(e12) {
            this._core.unicodeService.activeVersion = e12;
          }
        };
      }, 744: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.BufferService = t7.MINIMUM_ROWS = t7.MINIMUM_COLS = void 0;
        const n6 = i9(8460), o10 = i9(844), a4 = i9(5295), h4 = i9(2585);
        t7.MINIMUM_COLS = 2, t7.MINIMUM_ROWS = 1;
        let c5 = t7.BufferService = class extends o10.Disposable {
          get buffer() {
            return this.buffers.active;
          }
          constructor(e12) {
            super(), this.isUserScrolling = false, this._onResize = this.register(new n6.EventEmitter()), this.onResize = this._onResize.event, this._onScroll = this.register(new n6.EventEmitter()), this.onScroll = this._onScroll.event, this.cols = Math.max(e12.rawOptions.cols || 0, t7.MINIMUM_COLS), this.rows = Math.max(e12.rawOptions.rows || 0, t7.MINIMUM_ROWS), this.buffers = this.register(new a4.BufferSet(e12, this));
          }
          resize(e12, t8) {
            this.cols = e12, this.rows = t8, this.buffers.resize(e12, t8), this._onResize.fire({ cols: e12, rows: t8 });
          }
          reset() {
            this.buffers.reset(), this.isUserScrolling = false;
          }
          scroll(e12, t8 = false) {
            const i10 = this.buffer;
            let s6;
            s6 = this._cachedBlankLine, s6 && s6.length === this.cols && s6.getFg(0) === e12.fg && s6.getBg(0) === e12.bg || (s6 = i10.getBlankLine(e12, t8), this._cachedBlankLine = s6), s6.isWrapped = t8;
            const r12 = i10.ybase + i10.scrollTop, n7 = i10.ybase + i10.scrollBottom;
            if (0 === i10.scrollTop) {
              const e13 = i10.lines.isFull;
              n7 === i10.lines.length - 1 ? e13 ? i10.lines.recycle().copyFrom(s6) : i10.lines.push(s6.clone()) : i10.lines.splice(n7 + 1, 0, s6.clone()), e13 ? this.isUserScrolling && (i10.ydisp = Math.max(i10.ydisp - 1, 0)) : (i10.ybase++, this.isUserScrolling || i10.ydisp++);
            } else {
              const e13 = n7 - r12 + 1;
              i10.lines.shiftElements(r12 + 1, e13 - 1, -1), i10.lines.set(n7, s6.clone());
            }
            this.isUserScrolling || (i10.ydisp = i10.ybase), this._onScroll.fire(i10.ydisp);
          }
          scrollLines(e12, t8, i10) {
            const s6 = this.buffer;
            if (e12 < 0) {
              if (0 === s6.ydisp) return;
              this.isUserScrolling = true;
            } else e12 + s6.ydisp >= s6.ybase && (this.isUserScrolling = false);
            const r12 = s6.ydisp;
            s6.ydisp = Math.max(Math.min(s6.ydisp + e12, s6.ybase), 0), r12 !== s6.ydisp && (t8 || this._onScroll.fire(s6.ydisp));
          }
        };
        t7.BufferService = c5 = s5([r11(0, h4.IOptionsService)], c5);
      }, 7994: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CharsetService = void 0, t7.CharsetService = class {
          constructor() {
            this.glevel = 0, this._charsets = [];
          }
          reset() {
            this.charset = void 0, this._charsets = [], this.glevel = 0;
          }
          setgLevel(e12) {
            this.glevel = e12, this.charset = this._charsets[e12];
          }
          setgCharset(e12, t8) {
            this._charsets[e12] = t8, this.glevel === e12 && (this.charset = t8);
          }
        };
      }, 1753: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CoreMouseService = void 0;
        const n6 = i9(2585), o10 = i9(8460), a4 = i9(844), h4 = { NONE: { events: 0, restrict: () => false }, X10: { events: 1, restrict: (e12) => 4 !== e12.button && 1 === e12.action && (e12.ctrl = false, e12.alt = false, e12.shift = false, true) }, VT200: { events: 19, restrict: (e12) => 32 !== e12.action }, DRAG: { events: 23, restrict: (e12) => 32 !== e12.action || 3 !== e12.button }, ANY: { events: 31, restrict: (e12) => true } };
        function c5(e12, t8) {
          let i10 = (e12.ctrl ? 16 : 0) | (e12.shift ? 4 : 0) | (e12.alt ? 8 : 0);
          return 4 === e12.button ? (i10 |= 64, i10 |= e12.action) : (i10 |= 3 & e12.button, 4 & e12.button && (i10 |= 64), 8 & e12.button && (i10 |= 128), 32 === e12.action ? i10 |= 32 : 0 !== e12.action || t8 || (i10 |= 3)), i10;
        }
        const l6 = String.fromCharCode, d3 = { DEFAULT: (e12) => {
          const t8 = [c5(e12, false) + 32, e12.col + 32, e12.row + 32];
          return t8[0] > 255 || t8[1] > 255 || t8[2] > 255 ? "" : `\x1B[M${l6(t8[0])}${l6(t8[1])}${l6(t8[2])}`;
        }, SGR: (e12) => {
          const t8 = 0 === e12.action && 4 !== e12.button ? "m" : "M";
          return `\x1B[<${c5(e12, true)};${e12.col};${e12.row}${t8}`;
        }, SGR_PIXELS: (e12) => {
          const t8 = 0 === e12.action && 4 !== e12.button ? "m" : "M";
          return `\x1B[<${c5(e12, true)};${e12.x};${e12.y}${t8}`;
        } };
        let _3 = t7.CoreMouseService = class extends a4.Disposable {
          constructor(e12, t8) {
            super(), this._bufferService = e12, this._coreService = t8, this._protocols = {}, this._encodings = {}, this._activeProtocol = "", this._activeEncoding = "", this._lastEvent = null, this._onProtocolChange = this.register(new o10.EventEmitter()), this.onProtocolChange = this._onProtocolChange.event;
            for (const e13 of Object.keys(h4)) this.addProtocol(e13, h4[e13]);
            for (const e13 of Object.keys(d3)) this.addEncoding(e13, d3[e13]);
            this.reset();
          }
          addProtocol(e12, t8) {
            this._protocols[e12] = t8;
          }
          addEncoding(e12, t8) {
            this._encodings[e12] = t8;
          }
          get activeProtocol() {
            return this._activeProtocol;
          }
          get areMouseEventsActive() {
            return 0 !== this._protocols[this._activeProtocol].events;
          }
          set activeProtocol(e12) {
            if (!this._protocols[e12]) throw new Error(`unknown protocol "${e12}"`);
            this._activeProtocol = e12, this._onProtocolChange.fire(this._protocols[e12].events);
          }
          get activeEncoding() {
            return this._activeEncoding;
          }
          set activeEncoding(e12) {
            if (!this._encodings[e12]) throw new Error(`unknown encoding "${e12}"`);
            this._activeEncoding = e12;
          }
          reset() {
            this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null;
          }
          triggerMouseEvent(e12) {
            if (e12.col < 0 || e12.col >= this._bufferService.cols || e12.row < 0 || e12.row >= this._bufferService.rows) return false;
            if (4 === e12.button && 32 === e12.action) return false;
            if (3 === e12.button && 32 !== e12.action) return false;
            if (4 !== e12.button && (2 === e12.action || 3 === e12.action)) return false;
            if (e12.col++, e12.row++, 32 === e12.action && this._lastEvent && this._equalEvents(this._lastEvent, e12, "SGR_PIXELS" === this._activeEncoding)) return false;
            if (!this._protocols[this._activeProtocol].restrict(e12)) return false;
            const t8 = this._encodings[this._activeEncoding](e12);
            return t8 && ("DEFAULT" === this._activeEncoding ? this._coreService.triggerBinaryEvent(t8) : this._coreService.triggerDataEvent(t8, true)), this._lastEvent = e12, true;
          }
          explainEvents(e12) {
            return { down: !!(1 & e12), up: !!(2 & e12), drag: !!(4 & e12), move: !!(8 & e12), wheel: !!(16 & e12) };
          }
          _equalEvents(e12, t8, i10) {
            if (i10) {
              if (e12.x !== t8.x) return false;
              if (e12.y !== t8.y) return false;
            } else {
              if (e12.col !== t8.col) return false;
              if (e12.row !== t8.row) return false;
            }
            return e12.button === t8.button && e12.action === t8.action && e12.ctrl === t8.ctrl && e12.alt === t8.alt && e12.shift === t8.shift;
          }
        };
        t7.CoreMouseService = _3 = s5([r11(0, n6.IBufferService), r11(1, n6.ICoreService)], _3);
      }, 6975: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.CoreService = void 0;
        const n6 = i9(1439), o10 = i9(8460), a4 = i9(844), h4 = i9(2585), c5 = Object.freeze({ insertMode: false }), l6 = Object.freeze({ applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false, origin: false, reverseWraparound: false, sendFocus: false, wraparound: true });
        let d3 = t7.CoreService = class extends a4.Disposable {
          constructor(e12, t8, i10) {
            super(), this._bufferService = e12, this._logService = t8, this._optionsService = i10, this.isCursorInitialized = false, this.isCursorHidden = false, this._onData = this.register(new o10.EventEmitter()), this.onData = this._onData.event, this._onUserInput = this.register(new o10.EventEmitter()), this.onUserInput = this._onUserInput.event, this._onBinary = this.register(new o10.EventEmitter()), this.onBinary = this._onBinary.event, this._onRequestScrollToBottom = this.register(new o10.EventEmitter()), this.onRequestScrollToBottom = this._onRequestScrollToBottom.event, this.modes = (0, n6.clone)(c5), this.decPrivateModes = (0, n6.clone)(l6);
          }
          reset() {
            this.modes = (0, n6.clone)(c5), this.decPrivateModes = (0, n6.clone)(l6);
          }
          triggerDataEvent(e12, t8 = false) {
            if (this._optionsService.rawOptions.disableStdin) return;
            const i10 = this._bufferService.buffer;
            t8 && this._optionsService.rawOptions.scrollOnUserInput && i10.ybase !== i10.ydisp && this._onRequestScrollToBottom.fire(), t8 && this._onUserInput.fire(), this._logService.debug(`sending data "${e12}"`, (() => e12.split("").map(((e13) => e13.charCodeAt(0))))), this._onData.fire(e12);
          }
          triggerBinaryEvent(e12) {
            this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e12}"`, (() => e12.split("").map(((e13) => e13.charCodeAt(0))))), this._onBinary.fire(e12));
          }
        };
        t7.CoreService = d3 = s5([r11(0, h4.IBufferService), r11(1, h4.ILogService), r11(2, h4.IOptionsService)], d3);
      }, 9074: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.DecorationService = void 0;
        const s5 = i9(8055), r11 = i9(8460), n6 = i9(844), o10 = i9(6106);
        let a4 = 0, h4 = 0;
        class c5 extends n6.Disposable {
          get decorations() {
            return this._decorations.values();
          }
          constructor() {
            super(), this._decorations = new o10.SortedList(((e12) => null == e12 ? void 0 : e12.marker.line)), this._onDecorationRegistered = this.register(new r11.EventEmitter()), this.onDecorationRegistered = this._onDecorationRegistered.event, this._onDecorationRemoved = this.register(new r11.EventEmitter()), this.onDecorationRemoved = this._onDecorationRemoved.event, this.register((0, n6.toDisposable)((() => this.reset())));
          }
          registerDecoration(e12) {
            if (e12.marker.isDisposed) return;
            const t8 = new l6(e12);
            if (t8) {
              const e13 = t8.marker.onDispose((() => t8.dispose()));
              t8.onDispose((() => {
                t8 && (this._decorations.delete(t8) && this._onDecorationRemoved.fire(t8), e13.dispose());
              })), this._decorations.insert(t8), this._onDecorationRegistered.fire(t8);
            }
            return t8;
          }
          reset() {
            for (const e12 of this._decorations.values()) e12.dispose();
            this._decorations.clear();
          }
          *getDecorationsAtCell(e12, t8, i10) {
            var s6, r12, n7;
            let o11 = 0, a5 = 0;
            for (const h5 of this._decorations.getKeyIterator(t8)) o11 = null !== (s6 = h5.options.x) && void 0 !== s6 ? s6 : 0, a5 = o11 + (null !== (r12 = h5.options.width) && void 0 !== r12 ? r12 : 1), e12 >= o11 && e12 < a5 && (!i10 || (null !== (n7 = h5.options.layer) && void 0 !== n7 ? n7 : "bottom") === i10) && (yield h5);
          }
          forEachDecorationAtCell(e12, t8, i10, s6) {
            this._decorations.forEachByKey(t8, ((t9) => {
              var r12, n7, o11;
              a4 = null !== (r12 = t9.options.x) && void 0 !== r12 ? r12 : 0, h4 = a4 + (null !== (n7 = t9.options.width) && void 0 !== n7 ? n7 : 1), e12 >= a4 && e12 < h4 && (!i10 || (null !== (o11 = t9.options.layer) && void 0 !== o11 ? o11 : "bottom") === i10) && s6(t9);
            }));
          }
        }
        t7.DecorationService = c5;
        class l6 extends n6.Disposable {
          get isDisposed() {
            return this._isDisposed;
          }
          get backgroundColorRGB() {
            return null === this._cachedBg && (this.options.backgroundColor ? this._cachedBg = s5.css.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
          }
          get foregroundColorRGB() {
            return null === this._cachedFg && (this.options.foregroundColor ? this._cachedFg = s5.css.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
          }
          constructor(e12) {
            super(), this.options = e12, this.onRenderEmitter = this.register(new r11.EventEmitter()), this.onRender = this.onRenderEmitter.event, this._onDispose = this.register(new r11.EventEmitter()), this.onDispose = this._onDispose.event, this._cachedBg = null, this._cachedFg = null, this.marker = e12.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
          }
          dispose() {
            this._onDispose.fire(), super.dispose();
          }
        }
      }, 4348: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.InstantiationService = t7.ServiceCollection = void 0;
        const s5 = i9(2585), r11 = i9(8343);
        class n6 {
          constructor(...e12) {
            this._entries = /* @__PURE__ */ new Map();
            for (const [t8, i10] of e12) this.set(t8, i10);
          }
          set(e12, t8) {
            const i10 = this._entries.get(e12);
            return this._entries.set(e12, t8), i10;
          }
          forEach(e12) {
            for (const [t8, i10] of this._entries.entries()) e12(t8, i10);
          }
          has(e12) {
            return this._entries.has(e12);
          }
          get(e12) {
            return this._entries.get(e12);
          }
        }
        t7.ServiceCollection = n6, t7.InstantiationService = class {
          constructor() {
            this._services = new n6(), this._services.set(s5.IInstantiationService, this);
          }
          setService(e12, t8) {
            this._services.set(e12, t8);
          }
          getService(e12) {
            return this._services.get(e12);
          }
          createInstance(e12, ...t8) {
            const i10 = (0, r11.getServiceDependencies)(e12).sort(((e13, t9) => e13.index - t9.index)), s6 = [];
            for (const t9 of i10) {
              const i11 = this._services.get(t9.id);
              if (!i11) throw new Error(`[createInstance] ${e12.name} depends on UNKNOWN service ${t9.id}.`);
              s6.push(i11);
            }
            const n7 = i10.length > 0 ? i10[0].index : t8.length;
            if (t8.length !== n7) throw new Error(`[createInstance] First service dependency of ${e12.name} at position ${n7 + 1} conflicts with ${t8.length} static arguments`);
            return new e12(...[...t8, ...s6]);
          }
        };
      }, 7866: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a5 = e12.length - 1; a5 >= 0; a5--) (r12 = e12[a5]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.traceCall = t7.setTraceLogger = t7.LogService = void 0;
        const n6 = i9(844), o10 = i9(2585), a4 = { trace: o10.LogLevelEnum.TRACE, debug: o10.LogLevelEnum.DEBUG, info: o10.LogLevelEnum.INFO, warn: o10.LogLevelEnum.WARN, error: o10.LogLevelEnum.ERROR, off: o10.LogLevelEnum.OFF };
        let h4, c5 = t7.LogService = class extends n6.Disposable {
          get logLevel() {
            return this._logLevel;
          }
          constructor(e12) {
            super(), this._optionsService = e12, this._logLevel = o10.LogLevelEnum.OFF, this._updateLogLevel(), this.register(this._optionsService.onSpecificOptionChange("logLevel", (() => this._updateLogLevel()))), h4 = this;
          }
          _updateLogLevel() {
            this._logLevel = a4[this._optionsService.rawOptions.logLevel];
          }
          _evalLazyOptionalParams(e12) {
            for (let t8 = 0; t8 < e12.length; t8++) "function" == typeof e12[t8] && (e12[t8] = e12[t8]());
          }
          _log(e12, t8, i10) {
            this._evalLazyOptionalParams(i10), e12.call(console, (this._optionsService.options.logger ? "" : "xterm.js: ") + t8, ...i10);
          }
          trace(e12, ...t8) {
            var i10, s6;
            this._logLevel <= o10.LogLevelEnum.TRACE && this._log(null !== (s6 = null === (i10 = this._optionsService.options.logger) || void 0 === i10 ? void 0 : i10.trace.bind(this._optionsService.options.logger)) && void 0 !== s6 ? s6 : console.log, e12, t8);
          }
          debug(e12, ...t8) {
            var i10, s6;
            this._logLevel <= o10.LogLevelEnum.DEBUG && this._log(null !== (s6 = null === (i10 = this._optionsService.options.logger) || void 0 === i10 ? void 0 : i10.debug.bind(this._optionsService.options.logger)) && void 0 !== s6 ? s6 : console.log, e12, t8);
          }
          info(e12, ...t8) {
            var i10, s6;
            this._logLevel <= o10.LogLevelEnum.INFO && this._log(null !== (s6 = null === (i10 = this._optionsService.options.logger) || void 0 === i10 ? void 0 : i10.info.bind(this._optionsService.options.logger)) && void 0 !== s6 ? s6 : console.info, e12, t8);
          }
          warn(e12, ...t8) {
            var i10, s6;
            this._logLevel <= o10.LogLevelEnum.WARN && this._log(null !== (s6 = null === (i10 = this._optionsService.options.logger) || void 0 === i10 ? void 0 : i10.warn.bind(this._optionsService.options.logger)) && void 0 !== s6 ? s6 : console.warn, e12, t8);
          }
          error(e12, ...t8) {
            var i10, s6;
            this._logLevel <= o10.LogLevelEnum.ERROR && this._log(null !== (s6 = null === (i10 = this._optionsService.options.logger) || void 0 === i10 ? void 0 : i10.error.bind(this._optionsService.options.logger)) && void 0 !== s6 ? s6 : console.error, e12, t8);
          }
        };
        t7.LogService = c5 = s5([r11(0, o10.IOptionsService)], c5), t7.setTraceLogger = function(e12) {
          h4 = e12;
        }, t7.traceCall = function(e12, t8, i10) {
          if ("function" != typeof i10.value) throw new Error("not supported");
          const s6 = i10.value;
          i10.value = function(...e13) {
            if (h4.logLevel !== o10.LogLevelEnum.TRACE) return s6.apply(this, e13);
            h4.trace(`GlyphRenderer#${s6.name}(${e13.map(((e14) => JSON.stringify(e14))).join(", ")})`);
            const t9 = s6.apply(this, e13);
            return h4.trace(`GlyphRenderer#${s6.name} return`, t9), t9;
          };
        };
      }, 7302: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.OptionsService = t7.DEFAULT_OPTIONS = void 0;
        const s5 = i9(8460), r11 = i9(844), n6 = i9(6114);
        t7.DEFAULT_OPTIONS = { cols: 80, rows: 24, cursorBlink: false, cursorStyle: "block", cursorWidth: 1, cursorInactiveStyle: "outline", customGlyphs: true, drawBoldTextInBrightColors: true, fastScrollModifier: "alt", fastScrollSensitivity: 5, fontFamily: "courier-new, courier, monospace", fontSize: 15, fontWeight: "normal", fontWeightBold: "bold", ignoreBracketedPasteMode: false, lineHeight: 1, letterSpacing: 0, linkHandler: null, logLevel: "info", logger: null, scrollback: 1e3, scrollOnUserInput: true, scrollSensitivity: 1, screenReaderMode: false, smoothScrollDuration: 0, macOptionIsMeta: false, macOptionClickForcesSelection: false, minimumContrastRatio: 1, disableStdin: false, allowProposedApi: false, allowTransparency: false, tabStopWidth: 8, theme: {}, rightClickSelectsWord: n6.isMac, windowOptions: {}, windowsMode: false, windowsPty: {}, wordSeparator: " ()[]{}',\"`", altClickMovesCursor: true, convertEol: false, termName: "xterm", cancelEvents: false, overviewRulerWidth: 0 };
        const o10 = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
        class a4 extends r11.Disposable {
          constructor(e12) {
            super(), this._onOptionChange = this.register(new s5.EventEmitter()), this.onOptionChange = this._onOptionChange.event;
            const i10 = Object.assign({}, t7.DEFAULT_OPTIONS);
            for (const t8 in e12) if (t8 in i10) try {
              const s6 = e12[t8];
              i10[t8] = this._sanitizeAndValidateOption(t8, s6);
            } catch (e13) {
              console.error(e13);
            }
            this.rawOptions = i10, this.options = Object.assign({}, i10), this._setupOptions();
          }
          onSpecificOptionChange(e12, t8) {
            return this.onOptionChange(((i10) => {
              i10 === e12 && t8(this.rawOptions[e12]);
            }));
          }
          onMultipleOptionChange(e12, t8) {
            return this.onOptionChange(((i10) => {
              -1 !== e12.indexOf(i10) && t8();
            }));
          }
          _setupOptions() {
            const e12 = (e13) => {
              if (!(e13 in t7.DEFAULT_OPTIONS)) throw new Error(`No option with key "${e13}"`);
              return this.rawOptions[e13];
            }, i10 = (e13, i11) => {
              if (!(e13 in t7.DEFAULT_OPTIONS)) throw new Error(`No option with key "${e13}"`);
              i11 = this._sanitizeAndValidateOption(e13, i11), this.rawOptions[e13] !== i11 && (this.rawOptions[e13] = i11, this._onOptionChange.fire(e13));
            };
            for (const t8 in this.rawOptions) {
              const s6 = { get: e12.bind(this, t8), set: i10.bind(this, t8) };
              Object.defineProperty(this.options, t8, s6);
            }
          }
          _sanitizeAndValidateOption(e12, i10) {
            switch (e12) {
              case "cursorStyle":
                if (i10 || (i10 = t7.DEFAULT_OPTIONS[e12]), !/* @__PURE__ */ (function(e13) {
                  return "block" === e13 || "underline" === e13 || "bar" === e13;
                })(i10)) throw new Error(`"${i10}" is not a valid value for ${e12}`);
                break;
              case "wordSeparator":
                i10 || (i10 = t7.DEFAULT_OPTIONS[e12]);
                break;
              case "fontWeight":
              case "fontWeightBold":
                if ("number" == typeof i10 && 1 <= i10 && i10 <= 1e3) break;
                i10 = o10.includes(i10) ? i10 : t7.DEFAULT_OPTIONS[e12];
                break;
              case "cursorWidth":
                i10 = Math.floor(i10);
              case "lineHeight":
              case "tabStopWidth":
                if (i10 < 1) throw new Error(`${e12} cannot be less than 1, value: ${i10}`);
                break;
              case "minimumContrastRatio":
                i10 = Math.max(1, Math.min(21, Math.round(10 * i10) / 10));
                break;
              case "scrollback":
                if ((i10 = Math.min(i10, 4294967295)) < 0) throw new Error(`${e12} cannot be less than 0, value: ${i10}`);
                break;
              case "fastScrollSensitivity":
              case "scrollSensitivity":
                if (i10 <= 0) throw new Error(`${e12} cannot be less than or equal to 0, value: ${i10}`);
                break;
              case "rows":
              case "cols":
                if (!i10 && 0 !== i10) throw new Error(`${e12} must be numeric, value: ${i10}`);
                break;
              case "windowsPty":
                i10 = null != i10 ? i10 : {};
            }
            return i10;
          }
        }
        t7.OptionsService = a4;
      }, 2660: function(e11, t7, i9) {
        var s5 = this && this.__decorate || function(e12, t8, i10, s6) {
          var r12, n7 = arguments.length, o11 = n7 < 3 ? t8 : null === s6 ? s6 = Object.getOwnPropertyDescriptor(t8, i10) : s6;
          if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o11 = Reflect.decorate(e12, t8, i10, s6);
          else for (var a4 = e12.length - 1; a4 >= 0; a4--) (r12 = e12[a4]) && (o11 = (n7 < 3 ? r12(o11) : n7 > 3 ? r12(t8, i10, o11) : r12(t8, i10)) || o11);
          return n7 > 3 && o11 && Object.defineProperty(t8, i10, o11), o11;
        }, r11 = this && this.__param || function(e12, t8) {
          return function(i10, s6) {
            t8(i10, s6, e12);
          };
        };
        Object.defineProperty(t7, "__esModule", { value: true }), t7.OscLinkService = void 0;
        const n6 = i9(2585);
        let o10 = t7.OscLinkService = class {
          constructor(e12) {
            this._bufferService = e12, this._nextId = 1, this._entriesWithId = /* @__PURE__ */ new Map(), this._dataByLinkId = /* @__PURE__ */ new Map();
          }
          registerLink(e12) {
            const t8 = this._bufferService.buffer;
            if (void 0 === e12.id) {
              const i11 = t8.addMarker(t8.ybase + t8.y), s7 = { data: e12, id: this._nextId++, lines: [i11] };
              return i11.onDispose((() => this._removeMarkerFromLink(s7, i11))), this._dataByLinkId.set(s7.id, s7), s7.id;
            }
            const i10 = e12, s6 = this._getEntryIdKey(i10), r12 = this._entriesWithId.get(s6);
            if (r12) return this.addLineToLink(r12.id, t8.ybase + t8.y), r12.id;
            const n7 = t8.addMarker(t8.ybase + t8.y), o11 = { id: this._nextId++, key: this._getEntryIdKey(i10), data: i10, lines: [n7] };
            return n7.onDispose((() => this._removeMarkerFromLink(o11, n7))), this._entriesWithId.set(o11.key, o11), this._dataByLinkId.set(o11.id, o11), o11.id;
          }
          addLineToLink(e12, t8) {
            const i10 = this._dataByLinkId.get(e12);
            if (i10 && i10.lines.every(((e13) => e13.line !== t8))) {
              const e13 = this._bufferService.buffer.addMarker(t8);
              i10.lines.push(e13), e13.onDispose((() => this._removeMarkerFromLink(i10, e13)));
            }
          }
          getLinkData(e12) {
            var t8;
            return null === (t8 = this._dataByLinkId.get(e12)) || void 0 === t8 ? void 0 : t8.data;
          }
          _getEntryIdKey(e12) {
            return `${e12.id};;${e12.uri}`;
          }
          _removeMarkerFromLink(e12, t8) {
            const i10 = e12.lines.indexOf(t8);
            -1 !== i10 && (e12.lines.splice(i10, 1), 0 === e12.lines.length && (void 0 !== e12.data.id && this._entriesWithId.delete(e12.key), this._dataByLinkId.delete(e12.id)));
          }
        };
        t7.OscLinkService = o10 = s5([r11(0, n6.IBufferService)], o10);
      }, 8343: (e11, t7) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.createDecorator = t7.getServiceDependencies = t7.serviceRegistry = void 0;
        const i9 = "di$target", s5 = "di$dependencies";
        t7.serviceRegistry = /* @__PURE__ */ new Map(), t7.getServiceDependencies = function(e12) {
          return e12[s5] || [];
        }, t7.createDecorator = function(e12) {
          if (t7.serviceRegistry.has(e12)) return t7.serviceRegistry.get(e12);
          const r11 = function(e13, t8, n6) {
            if (3 !== arguments.length) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
            !(function(e14, t9, r12) {
              t9[i9] === t9 ? t9[s5].push({ id: e14, index: r12 }) : (t9[s5] = [{ id: e14, index: r12 }], t9[i9] = t9);
            })(r11, e13, n6);
          };
          return r11.toString = () => e12, t7.serviceRegistry.set(e12, r11), r11;
        };
      }, 2585: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.IDecorationService = t7.IUnicodeService = t7.IOscLinkService = t7.IOptionsService = t7.ILogService = t7.LogLevelEnum = t7.IInstantiationService = t7.ICharsetService = t7.ICoreService = t7.ICoreMouseService = t7.IBufferService = void 0;
        const s5 = i9(8343);
        var r11;
        t7.IBufferService = (0, s5.createDecorator)("BufferService"), t7.ICoreMouseService = (0, s5.createDecorator)("CoreMouseService"), t7.ICoreService = (0, s5.createDecorator)("CoreService"), t7.ICharsetService = (0, s5.createDecorator)("CharsetService"), t7.IInstantiationService = (0, s5.createDecorator)("InstantiationService"), (function(e12) {
          e12[e12.TRACE = 0] = "TRACE", e12[e12.DEBUG = 1] = "DEBUG", e12[e12.INFO = 2] = "INFO", e12[e12.WARN = 3] = "WARN", e12[e12.ERROR = 4] = "ERROR", e12[e12.OFF = 5] = "OFF";
        })(r11 || (t7.LogLevelEnum = r11 = {})), t7.ILogService = (0, s5.createDecorator)("LogService"), t7.IOptionsService = (0, s5.createDecorator)("OptionsService"), t7.IOscLinkService = (0, s5.createDecorator)("OscLinkService"), t7.IUnicodeService = (0, s5.createDecorator)("UnicodeService"), t7.IDecorationService = (0, s5.createDecorator)("DecorationService");
      }, 1480: (e11, t7, i9) => {
        Object.defineProperty(t7, "__esModule", { value: true }), t7.UnicodeService = void 0;
        const s5 = i9(8460), r11 = i9(225);
        t7.UnicodeService = class {
          constructor() {
            this._providers = /* @__PURE__ */ Object.create(null), this._active = "", this._onChange = new s5.EventEmitter(), this.onChange = this._onChange.event;
            const e12 = new r11.UnicodeV6();
            this.register(e12), this._active = e12.version, this._activeProvider = e12;
          }
          dispose() {
            this._onChange.dispose();
          }
          get versions() {
            return Object.keys(this._providers);
          }
          get activeVersion() {
            return this._active;
          }
          set activeVersion(e12) {
            if (!this._providers[e12]) throw new Error(`unknown Unicode version "${e12}"`);
            this._active = e12, this._activeProvider = this._providers[e12], this._onChange.fire(e12);
          }
          register(e12) {
            this._providers[e12.version] = e12;
          }
          wcwidth(e12) {
            return this._activeProvider.wcwidth(e12);
          }
          getStringCellWidth(e12) {
            let t8 = 0;
            const i10 = e12.length;
            for (let s6 = 0; s6 < i10; ++s6) {
              let r12 = e12.charCodeAt(s6);
              if (55296 <= r12 && r12 <= 56319) {
                if (++s6 >= i10) return t8 + this.wcwidth(r12);
                const n6 = e12.charCodeAt(s6);
                56320 <= n6 && n6 <= 57343 ? r12 = 1024 * (r12 - 55296) + n6 - 56320 + 65536 : t8 += this.wcwidth(n6);
              }
              t8 += this.wcwidth(r12);
            }
            return t8;
          }
        };
      } }, t6 = {};
      function i8(s5) {
        var r11 = t6[s5];
        if (void 0 !== r11) return r11.exports;
        var n6 = t6[s5] = { exports: {} };
        return e10[s5].call(n6.exports, n6, n6.exports, i8), n6.exports;
      }
      var s4 = {};
      return (() => {
        var e11 = s4;
        Object.defineProperty(e11, "__esModule", { value: true }), e11.Terminal = void 0;
        const t7 = i8(9042), r11 = i8(3236), n6 = i8(844), o10 = i8(5741), a4 = i8(8285), h4 = i8(7975), c5 = i8(7090), l6 = ["cols", "rows"];
        class d3 extends n6.Disposable {
          constructor(e12) {
            super(), this._core = this.register(new r11.Terminal(e12)), this._addonManager = this.register(new o10.AddonManager()), this._publicOptions = Object.assign({}, this._core.options);
            const t8 = (e13) => this._core.options[e13], i9 = (e13, t9) => {
              this._checkReadonlyOptions(e13), this._core.options[e13] = t9;
            };
            for (const e13 in this._core.options) {
              const s5 = { get: t8.bind(this, e13), set: i9.bind(this, e13) };
              Object.defineProperty(this._publicOptions, e13, s5);
            }
          }
          _checkReadonlyOptions(e12) {
            if (l6.includes(e12)) throw new Error(`Option "${e12}" can only be set in the constructor`);
          }
          _checkProposedApi() {
            if (!this._core.optionsService.rawOptions.allowProposedApi) throw new Error("You must set the allowProposedApi option to true to use proposed API");
          }
          get onBell() {
            return this._core.onBell;
          }
          get onBinary() {
            return this._core.onBinary;
          }
          get onCursorMove() {
            return this._core.onCursorMove;
          }
          get onData() {
            return this._core.onData;
          }
          get onKey() {
            return this._core.onKey;
          }
          get onLineFeed() {
            return this._core.onLineFeed;
          }
          get onRender() {
            return this._core.onRender;
          }
          get onResize() {
            return this._core.onResize;
          }
          get onScroll() {
            return this._core.onScroll;
          }
          get onSelectionChange() {
            return this._core.onSelectionChange;
          }
          get onTitleChange() {
            return this._core.onTitleChange;
          }
          get onWriteParsed() {
            return this._core.onWriteParsed;
          }
          get element() {
            return this._core.element;
          }
          get parser() {
            return this._parser || (this._parser = new h4.ParserApi(this._core)), this._parser;
          }
          get unicode() {
            return this._checkProposedApi(), new c5.UnicodeApi(this._core);
          }
          get textarea() {
            return this._core.textarea;
          }
          get rows() {
            return this._core.rows;
          }
          get cols() {
            return this._core.cols;
          }
          get buffer() {
            return this._buffer || (this._buffer = this.register(new a4.BufferNamespaceApi(this._core))), this._buffer;
          }
          get markers() {
            return this._checkProposedApi(), this._core.markers;
          }
          get modes() {
            const e12 = this._core.coreService.decPrivateModes;
            let t8 = "none";
            switch (this._core.coreMouseService.activeProtocol) {
              case "X10":
                t8 = "x10";
                break;
              case "VT200":
                t8 = "vt200";
                break;
              case "DRAG":
                t8 = "drag";
                break;
              case "ANY":
                t8 = "any";
            }
            return { applicationCursorKeysMode: e12.applicationCursorKeys, applicationKeypadMode: e12.applicationKeypad, bracketedPasteMode: e12.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: t8, originMode: e12.origin, reverseWraparoundMode: e12.reverseWraparound, sendFocusMode: e12.sendFocus, wraparoundMode: e12.wraparound };
          }
          get options() {
            return this._publicOptions;
          }
          set options(e12) {
            for (const t8 in e12) this._publicOptions[t8] = e12[t8];
          }
          blur() {
            this._core.blur();
          }
          focus() {
            this._core.focus();
          }
          resize(e12, t8) {
            this._verifyIntegers(e12, t8), this._core.resize(e12, t8);
          }
          open(e12) {
            this._core.open(e12);
          }
          attachCustomKeyEventHandler(e12) {
            this._core.attachCustomKeyEventHandler(e12);
          }
          registerLinkProvider(e12) {
            return this._core.registerLinkProvider(e12);
          }
          registerCharacterJoiner(e12) {
            return this._checkProposedApi(), this._core.registerCharacterJoiner(e12);
          }
          deregisterCharacterJoiner(e12) {
            this._checkProposedApi(), this._core.deregisterCharacterJoiner(e12);
          }
          registerMarker(e12 = 0) {
            return this._verifyIntegers(e12), this._core.registerMarker(e12);
          }
          registerDecoration(e12) {
            var t8, i9, s5;
            return this._checkProposedApi(), this._verifyPositiveIntegers(null !== (t8 = e12.x) && void 0 !== t8 ? t8 : 0, null !== (i9 = e12.width) && void 0 !== i9 ? i9 : 0, null !== (s5 = e12.height) && void 0 !== s5 ? s5 : 0), this._core.registerDecoration(e12);
          }
          hasSelection() {
            return this._core.hasSelection();
          }
          select(e12, t8, i9) {
            this._verifyIntegers(e12, t8, i9), this._core.select(e12, t8, i9);
          }
          getSelection() {
            return this._core.getSelection();
          }
          getSelectionPosition() {
            return this._core.getSelectionPosition();
          }
          clearSelection() {
            this._core.clearSelection();
          }
          selectAll() {
            this._core.selectAll();
          }
          selectLines(e12, t8) {
            this._verifyIntegers(e12, t8), this._core.selectLines(e12, t8);
          }
          dispose() {
            super.dispose();
          }
          scrollLines(e12) {
            this._verifyIntegers(e12), this._core.scrollLines(e12);
          }
          scrollPages(e12) {
            this._verifyIntegers(e12), this._core.scrollPages(e12);
          }
          scrollToTop() {
            this._core.scrollToTop();
          }
          scrollToBottom() {
            this._core.scrollToBottom();
          }
          scrollToLine(e12) {
            this._verifyIntegers(e12), this._core.scrollToLine(e12);
          }
          clear() {
            this._core.clear();
          }
          write(e12, t8) {
            this._core.write(e12, t8);
          }
          writeln(e12, t8) {
            this._core.write(e12), this._core.write("\r\n", t8);
          }
          paste(e12) {
            this._core.paste(e12);
          }
          refresh(e12, t8) {
            this._verifyIntegers(e12, t8), this._core.refresh(e12, t8);
          }
          reset() {
            this._core.reset();
          }
          clearTextureAtlas() {
            this._core.clearTextureAtlas();
          }
          loadAddon(e12) {
            this._addonManager.loadAddon(this, e12);
          }
          static get strings() {
            return t7;
          }
          _verifyIntegers(...e12) {
            for (const t8 of e12) if (t8 === 1 / 0 || isNaN(t8) || t8 % 1 != 0) throw new Error("This API only accepts integers");
          }
          _verifyPositiveIntegers(...e12) {
            for (const t8 of e12) if (t8 && (t8 === 1 / 0 || isNaN(t8) || t8 % 1 != 0 || t8 < 0)) throw new Error("This API only accepts positive integers");
          }
        }
        e11.Terminal = d3;
      })(), s4;
    })()));
  }
});

// node_modules/@xterm/addon-fit/lib/addon-fit.mjs
var addon_fit_exports = {};
__export(addon_fit_exports, {
  FitAddon: () => o3
});
var h2, _2, o3;
var init_addon_fit = __esm({
  "node_modules/@xterm/addon-fit/lib/addon-fit.mjs"() {
    h2 = 2;
    _2 = 1;
    o3 = class {
      activate(e10) {
        this._terminal = e10;
      }
      dispose() {
      }
      fit() {
        let e10 = this.proposeDimensions();
        if (!e10 || !this._terminal || isNaN(e10.cols) || isNaN(e10.rows)) return;
        let t6 = this._terminal._core;
        (this._terminal.rows !== e10.rows || this._terminal.cols !== e10.cols) && (t6._renderService.clear(), this._terminal.resize(e10.cols, e10.rows));
      }
      proposeDimensions() {
        if (!this._terminal || !this._terminal.element || !this._terminal.element.parentElement) return;
        let t6 = this._terminal._core._renderService.dimensions;
        if (t6.css.cell.width === 0 || t6.css.cell.height === 0) return;
        let s4 = this._terminal.options.scrollback === 0 ? 0 : this._terminal.options.overviewRuler?.width || 14, r11 = window.getComputedStyle(this._terminal.element.parentElement), l6 = parseInt(r11.getPropertyValue("height")), a4 = Math.max(0, parseInt(r11.getPropertyValue("width"))), i8 = window.getComputedStyle(this._terminal.element), n6 = { top: parseInt(i8.getPropertyValue("padding-top")), bottom: parseInt(i8.getPropertyValue("padding-bottom")), right: parseInt(i8.getPropertyValue("padding-right")), left: parseInt(i8.getPropertyValue("padding-left")) }, m3 = n6.top + n6.bottom, d3 = n6.right + n6.left, c5 = l6 - m3, p4 = a4 - d3 - s4;
        return { cols: Math.max(h2, Math.floor(p4 / t6.css.cell.width)), rows: Math.max(_2, Math.floor(c5 / t6.css.cell.height)) };
      }
    };
  }
});

// node_modules/@xterm/addon-search/lib/addon-search.mjs
var addon_search_exports = {};
__export(addon_search_exports, {
  SearchAddon: () => ut
});
function le(r11) {
  ft(r11) || pt.onUnexpectedError(r11);
}
function ft(r11) {
  return r11 instanceof ee ? true : r11 instanceof Error && r11.name === Ce && r11.message === Ce;
}
function mt(r11, e10, t6 = 0, n6 = r11.length) {
  let i8 = t6, s4 = n6;
  for (; i8 < s4; ) {
    let a4 = Math.floor((i8 + s4) / 2);
    e10(r11[a4]) ? i8 = a4 + 1 : s4 = a4;
  }
  return i8 - 1;
}
function $e(r11, e10) {
  return (t6, n6) => e10(r11(t6), r11(n6));
}
function Xe(r11, e10) {
  let t6 = /* @__PURE__ */ Object.create(null);
  for (let n6 of r11) {
    let i8 = e10(n6), s4 = t6[i8];
    s4 || (s4 = t6[i8] = []), s4.push(n6);
  }
  return t6;
}
function Pe(r11, e10) {
  let t6 = this, n6 = false, i8;
  return function() {
    if (n6) return i8;
    if (n6 = true, e10) try {
      i8 = r11.apply(t6, arguments);
    } finally {
      e10();
    }
    else i8 = r11.apply(t6, arguments);
    return i8;
  };
}
function vt(r11) {
  K = r11;
}
function pe(r11) {
  return K?.trackDisposable(r11), r11;
}
function fe(r11) {
  K?.markAsDisposed(r11);
}
function te(r11, e10) {
  K?.setParent(r11, e10);
}
function bt(r11, e10) {
  if (K) for (let t6 of r11) K.setParent(t6, e10);
}
function Q(r11) {
  if (Le.is(r11)) {
    let e10 = [];
    for (let t6 of r11) if (t6) try {
      t6.dispose();
    } catch (n6) {
      e10.push(n6);
    }
    if (e10.length === 1) throw e10[0];
    if (e10.length > 1) throw new AggregateError(e10, "Encountered errors while disposing of store");
    return Array.isArray(r11) ? [] : r11;
  } else if (r11) return r11.dispose(), r11;
}
function me(...r11) {
  let e10 = A2(() => Q(r11));
  return bt(r11, e10), e10;
}
function A2(r11) {
  let e10 = pe({ dispose: Pe(() => {
    fe(e10), r11();
  }) });
  return e10;
}
function xe(r11, e10 = 0, t6) {
  let n6 = setTimeout(() => {
    r11(), t6 && i8.dispose();
  }, e10), i8 = A2(() => {
    clearTimeout(n6), t6?.deleteAndLeak(i8);
  });
  return t6?.add(i8), i8;
}
var Re, pt, Ce, ee, ae, ue, Qe, Be, V2, Ye, Je, Ge, ce, Le, Tt, K, de, he, H2, k2, F, $2, _t, Te, gt, tt, yt, ie, B2, Oe, nt, be, Ae, ne, Me, Fe, xt, G, It, Dt, ve, C2, Ne, it, Et, We, Y, qe, ze, ge, wt, kt, st, St, Rt, Ct, Pt, _e, ye, rt, Lt, N2, W, O, ot, Ot, je, At, gn, M2, j2, Mt, Ft, at, Nt, yn, xn, In, Dn, jt, Ue, qt, P2, Ie, De, Ee, we, ke, ut;
var init_addon_search = __esm({
  "node_modules/@xterm/addon-search/lib/addon-search.mjs"() {
    Re = class {
      constructor() {
        this.listeners = [], this.unexpectedErrorHandler = function(e10) {
          setTimeout(() => {
            throw e10.stack ? ae.isErrorNoTelemetry(e10) ? new ae(e10.message + `

` + e10.stack) : new Error(e10.message + `

` + e10.stack) : e10;
          }, 0);
        };
      }
      addListener(e10) {
        return this.listeners.push(e10), () => {
          this._removeListener(e10);
        };
      }
      emit(e10) {
        this.listeners.forEach((t6) => {
          t6(e10);
        });
      }
      _removeListener(e10) {
        this.listeners.splice(this.listeners.indexOf(e10), 1);
      }
      setUnexpectedErrorHandler(e10) {
        this.unexpectedErrorHandler = e10;
      }
      getUnexpectedErrorHandler() {
        return this.unexpectedErrorHandler;
      }
      onUnexpectedError(e10) {
        this.unexpectedErrorHandler(e10), this.emit(e10);
      }
      onUnexpectedExternalError(e10) {
        this.unexpectedErrorHandler(e10);
      }
    };
    pt = new Re();
    Ce = "Canceled";
    ee = class extends Error {
      constructor() {
        super(Ce), this.name = this.message;
      }
    };
    ae = class r2 extends Error {
      constructor(e10) {
        super(e10), this.name = "CodeExpectedError";
      }
      static fromError(e10) {
        if (e10 instanceof r2) return e10;
        let t6 = new r2();
        return t6.message = e10.message, t6.stack = e10.stack, t6;
      }
      static isErrorNoTelemetry(e10) {
        return e10.name === "CodeExpectedError";
      }
    };
    ue = class ue2 {
      constructor(e10) {
        this._array = e10;
        this._findLastMonotonousLastIdx = 0;
      }
      findLastMonotonous(e10) {
        if (ue2.assertInvariants) {
          if (this._prevFindLastPredicate) {
            for (let n6 of this._array) if (this._prevFindLastPredicate(n6) && !e10(n6)) throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.");
          }
          this._prevFindLastPredicate = e10;
        }
        let t6 = mt(this._array, e10, this._findLastMonotonousLastIdx);
        return this._findLastMonotonousLastIdx = t6 + 1, t6 === -1 ? void 0 : this._array[t6];
      }
    };
    ue.assertInvariants = false;
    ((h4) => {
      function r11(u4) {
        return u4 < 0;
      }
      h4.isLessThan = r11;
      function e10(u4) {
        return u4 <= 0;
      }
      h4.isLessThanOrEqual = e10;
      function t6(u4) {
        return u4 > 0;
      }
      h4.isGreaterThan = t6;
      function n6(u4) {
        return u4 === 0;
      }
      h4.isNeitherLessOrGreaterThan = n6, h4.greaterThan = 1, h4.lessThan = -1, h4.neitherLessOrGreaterThan = 0;
    })(Qe ||= {});
    Be = (r11, e10) => r11 - e10;
    V2 = class V3 {
      constructor(e10) {
        this.iterate = e10;
      }
      forEach(e10) {
        this.iterate((t6) => (e10(t6), true));
      }
      toArray() {
        let e10 = [];
        return this.iterate((t6) => (e10.push(t6), true)), e10;
      }
      filter(e10) {
        return new V3((t6) => this.iterate((n6) => e10(n6) ? t6(n6) : true));
      }
      map(e10) {
        return new V3((t6) => this.iterate((n6) => t6(e10(n6))));
      }
      some(e10) {
        let t6 = false;
        return this.iterate((n6) => (t6 = e10(n6), !t6)), t6;
      }
      findFirst(e10) {
        let t6;
        return this.iterate((n6) => e10(n6) ? (t6 = n6, false) : true), t6;
      }
      findLast(e10) {
        let t6;
        return this.iterate((n6) => (e10(n6) && (t6 = n6), true)), t6;
      }
      findLastMaxBy(e10) {
        let t6, n6 = true;
        return this.iterate((i8) => ((n6 || Qe.isGreaterThan(e10(i8, t6))) && (n6 = false, t6 = i8), true)), t6;
      }
    };
    V2.empty = new V2((e10) => {
    });
    Ge = class {
      constructor(e10, t6) {
        this.toKey = t6;
        this._map = /* @__PURE__ */ new Map();
        this[Ye] = "SetWithKey";
        for (let n6 of e10) this.add(n6);
      }
      get size() {
        return this._map.size;
      }
      add(e10) {
        let t6 = this.toKey(e10);
        return this._map.set(t6, e10), this;
      }
      delete(e10) {
        return this._map.delete(this.toKey(e10));
      }
      has(e10) {
        return this._map.has(this.toKey(e10));
      }
      *entries() {
        for (let e10 of this._map.values()) yield [e10, e10];
      }
      keys() {
        return this.values();
      }
      *values() {
        for (let e10 of this._map.values()) yield e10;
      }
      clear() {
        this._map.clear();
      }
      forEach(e10, t6) {
        this._map.forEach((n6) => e10.call(t6, n6, n6, this));
      }
      [(Je = Symbol.iterator, Ye = Symbol.toStringTag, Je)]() {
        return this.values();
      }
    };
    ce = class {
      constructor() {
        this.map = /* @__PURE__ */ new Map();
      }
      add(e10, t6) {
        let n6 = this.map.get(e10);
        n6 || (n6 = /* @__PURE__ */ new Set(), this.map.set(e10, n6)), n6.add(t6);
      }
      delete(e10, t6) {
        let n6 = this.map.get(e10);
        n6 && (n6.delete(t6), n6.size === 0 && this.map.delete(e10));
      }
      forEach(e10, t6) {
        let n6 = this.map.get(e10);
        n6 && n6.forEach(t6);
      }
      get(e10) {
        let t6 = this.map.get(e10);
        return t6 || /* @__PURE__ */ new Set();
      }
    };
    ((z2) => {
      function r11(m3) {
        return m3 && typeof m3 == "object" && typeof m3[Symbol.iterator] == "function";
      }
      z2.is = r11;
      let e10 = Object.freeze([]);
      function t6() {
        return e10;
      }
      z2.empty = t6;
      function* n6(m3) {
        yield m3;
      }
      z2.single = n6;
      function i8(m3) {
        return r11(m3) ? m3 : n6(m3);
      }
      z2.wrap = i8;
      function s4(m3) {
        return m3 || e10;
      }
      z2.from = s4;
      function* a4(m3) {
        for (let _3 = m3.length - 1; _3 >= 0; _3--) yield m3[_3];
      }
      z2.reverse = a4;
      function h4(m3) {
        return !m3 || m3[Symbol.iterator]().next().done === true;
      }
      z2.isEmpty = h4;
      function u4(m3) {
        return m3[Symbol.iterator]().next().value;
      }
      z2.first = u4;
      function p4(m3, _3) {
        let y3 = 0;
        for (let L2 of m3) if (_3(L2, y3++)) return true;
        return false;
      }
      z2.some = p4;
      function T2(m3, _3) {
        for (let y3 of m3) if (_3(y3)) return y3;
      }
      z2.find = T2;
      function* v2(m3, _3) {
        for (let y3 of m3) _3(y3) && (yield y3);
      }
      z2.filter = v2;
      function* I2(m3, _3) {
        let y3 = 0;
        for (let L2 of m3) yield _3(L2, y3++);
      }
      z2.map = I2;
      function* E2(m3, _3) {
        let y3 = 0;
        for (let L2 of m3) yield* _3(L2, y3++);
      }
      z2.flatMap = E2;
      function* S3(...m3) {
        for (let _3 of m3) yield* _3;
      }
      z2.concat = S3;
      function D2(m3, _3, y3) {
        let L2 = y3;
        for (let X of m3) L2 = _3(L2, X);
        return L2;
      }
      z2.reduce = D2;
      function* x2(m3, _3, y3 = m3.length) {
        for (_3 < 0 && (_3 += m3.length), y3 < 0 ? y3 += m3.length : y3 > m3.length && (y3 = m3.length); _3 < y3; _3++) yield m3[_3];
      }
      z2.slice = x2;
      function J(m3, _3 = Number.POSITIVE_INFINITY) {
        let y3 = [];
        if (_3 === 0) return [y3, m3];
        let L2 = m3[Symbol.iterator]();
        for (let X = 0; X < _3; X++) {
          let Se = L2.next();
          if (Se.done) return [y3, z2.empty()];
          y3.push(Se.value);
        }
        return [y3, { [Symbol.iterator]() {
          return L2;
        } }];
      }
      z2.consume = J;
      async function q(m3) {
        let _3 = [];
        for await (let y3 of m3) _3.push(y3);
        return Promise.resolve(_3);
      }
      z2.asyncToArray = q;
    })(Le ||= {});
    Tt = false;
    K = null;
    de = class de2 {
      constructor() {
        this.livingDisposables = /* @__PURE__ */ new Map();
      }
      getDisposableData(e10) {
        let t6 = this.livingDisposables.get(e10);
        return t6 || (t6 = { parent: null, source: null, isSingleton: false, value: e10, idx: de2.idx++ }, this.livingDisposables.set(e10, t6)), t6;
      }
      trackDisposable(e10) {
        let t6 = this.getDisposableData(e10);
        t6.source || (t6.source = new Error().stack);
      }
      setParent(e10, t6) {
        let n6 = this.getDisposableData(e10);
        n6.parent = t6;
      }
      markAsDisposed(e10) {
        this.livingDisposables.delete(e10);
      }
      markAsSingleton(e10) {
        this.getDisposableData(e10).isSingleton = true;
      }
      getRootParent(e10, t6) {
        let n6 = t6.get(e10);
        if (n6) return n6;
        let i8 = e10.parent ? this.getRootParent(this.getDisposableData(e10.parent), t6) : e10;
        return t6.set(e10, i8), i8;
      }
      getTrackedDisposables() {
        let e10 = /* @__PURE__ */ new Map();
        return [...this.livingDisposables.entries()].filter(([, n6]) => n6.source !== null && !this.getRootParent(n6, e10).isSingleton).flatMap(([n6]) => n6);
      }
      computeLeakingDisposables(e10 = 10, t6) {
        let n6;
        if (t6) n6 = t6;
        else {
          let u4 = /* @__PURE__ */ new Map(), p4 = [...this.livingDisposables.values()].filter((v2) => v2.source !== null && !this.getRootParent(v2, u4).isSingleton);
          if (p4.length === 0) return;
          let T2 = new Set(p4.map((v2) => v2.value));
          if (n6 = p4.filter((v2) => !(v2.parent && T2.has(v2.parent))), n6.length === 0) throw new Error("There are cyclic diposable chains!");
        }
        if (!n6) return;
        function i8(u4) {
          function p4(v2, I2) {
            for (; v2.length > 0 && I2.some((E2) => typeof E2 == "string" ? E2 === v2[0] : v2[0].match(E2)); ) v2.shift();
          }
          let T2 = u4.source.split(`
`).map((v2) => v2.trim().replace("at ", "")).filter((v2) => v2 !== "");
          return p4(T2, ["Error", /^trackDisposable \(.*\)$/, /^DisposableTracker.trackDisposable \(.*\)$/]), T2.reverse();
        }
        let s4 = new ce();
        for (let u4 of n6) {
          let p4 = i8(u4);
          for (let T2 = 0; T2 <= p4.length; T2++) s4.add(p4.slice(0, T2).join(`
`), u4);
        }
        n6.sort($e((u4) => u4.idx, Be));
        let a4 = "", h4 = 0;
        for (let u4 of n6.slice(0, e10)) {
          h4++;
          let p4 = i8(u4), T2 = [];
          for (let v2 = 0; v2 < p4.length; v2++) {
            let I2 = p4[v2];
            I2 = `(shared with ${s4.get(p4.slice(0, v2 + 1).join(`
`)).size}/${n6.length} leaks) at ${I2}`;
            let S3 = s4.get(p4.slice(0, v2).join(`
`)), D2 = Xe([...S3].map((x2) => i8(x2)[v2]), (x2) => x2);
            delete D2[p4[v2]];
            for (let [x2, J] of Object.entries(D2)) T2.unshift(`    - stacktraces of ${J.length} other leaks continue with ${x2}`);
            T2.unshift(I2);
          }
          a4 += `


==================== Leaking disposable ${h4}/${n6.length}: ${u4.value.constructor.name} ====================
${T2.join(`
`)}
============================================================

`;
        }
        return n6.length > e10 && (a4 += `


... and ${n6.length - e10} more leaking disposables

`), { leaks: n6, details: a4 };
      }
    };
    de.idx = 0;
    if (Tt) {
      let r11 = "__is_disposable_tracked__";
      vt(new class {
        trackDisposable(e10) {
          let t6 = new Error("Potentially leaked disposable").stack;
          setTimeout(() => {
            e10[r11] || console.log(t6);
          }, 3e3);
        }
        setParent(e10, t6) {
          if (e10 && e10 !== k2.None) try {
            e10[r11] = true;
          } catch {
          }
        }
        markAsDisposed(e10) {
          if (e10 && e10 !== k2.None) try {
            e10[r11] = true;
          } catch {
          }
        }
        markAsSingleton(e10) {
        }
      }());
    }
    he = class he2 {
      constructor() {
        this._toDispose = /* @__PURE__ */ new Set();
        this._isDisposed = false;
        pe(this);
      }
      dispose() {
        this._isDisposed || (fe(this), this._isDisposed = true, this.clear());
      }
      get isDisposed() {
        return this._isDisposed;
      }
      clear() {
        if (this._toDispose.size !== 0) try {
          Q(this._toDispose);
        } finally {
          this._toDispose.clear();
        }
      }
      add(e10) {
        if (!e10) return e10;
        if (e10 === this) throw new Error("Cannot register a disposable on itself!");
        return te(e10, this), this._isDisposed ? he2.DISABLE_DISPOSED_WARNING || console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack) : this._toDispose.add(e10), e10;
      }
      delete(e10) {
        if (e10) {
          if (e10 === this) throw new Error("Cannot dispose a disposable on itself!");
          this._toDispose.delete(e10), e10.dispose();
        }
      }
      deleteAndLeak(e10) {
        e10 && this._toDispose.has(e10) && (this._toDispose.delete(e10), te(e10, null));
      }
    };
    he.DISABLE_DISPOSED_WARNING = false;
    H2 = he;
    k2 = class {
      constructor() {
        this._store = new H2();
        pe(this), te(this._store, this);
      }
      dispose() {
        fe(this), this._store.dispose();
      }
      _register(e10) {
        if (e10 === this) throw new Error("Cannot register a disposable on itself!");
        return this._store.add(e10);
      }
    };
    k2.None = Object.freeze({ dispose() {
    } });
    F = class {
      constructor() {
        this._isDisposed = false;
        pe(this);
      }
      get value() {
        return this._isDisposed ? void 0 : this._value;
      }
      set value(e10) {
        this._isDisposed || e10 === this._value || (this._value?.dispose(), e10 && te(e10, this), this._value = e10);
      }
      clear() {
        this.value = void 0;
      }
      dispose() {
        this._isDisposed = true, fe(this), this._value?.dispose(), this._value = void 0;
      }
      clearAndLeak() {
        let e10 = this._value;
        return this._value = void 0, e10 && te(e10, null), e10;
      }
    };
    $2 = class $3 {
      constructor(e10) {
        this.element = e10, this.next = $3.Undefined, this.prev = $3.Undefined;
      }
    };
    $2.Undefined = new $2(void 0);
    _t = globalThis.performance && typeof globalThis.performance.now == "function";
    Te = class r3 {
      static create(e10) {
        return new r3(e10);
      }
      constructor(e10) {
        this._now = _t && e10 === false ? Date.now : globalThis.performance.now.bind(globalThis.performance), this._startTime = this._now(), this._stopTime = -1;
      }
      stop() {
        this._stopTime = this._now();
      }
      reset() {
        this._startTime = this._now(), this._stopTime = -1;
      }
      elapsed() {
        return this._stopTime !== -1 ? this._stopTime - this._startTime : this._now() - this._startTime;
      }
    };
    gt = false;
    tt = false;
    yt = false;
    ((re) => {
      re.None = () => k2.None;
      function e10(d3) {
        if (yt) {
          let { onDidAddListener: o10 } = d3, c5 = ne.create(), l6 = 0;
          d3.onDidAddListener = () => {
            ++l6 === 2 && (console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"), c5.print()), o10?.();
          };
        }
      }
      function t6(d3, o10) {
        return I2(d3, () => {
        }, 0, void 0, true, void 0, o10);
      }
      re.defer = t6;
      function n6(d3) {
        return (o10, c5 = null, l6) => {
          let f3 = false, b3;
          return b3 = d3((g2) => {
            if (!f3) return b3 ? b3.dispose() : f3 = true, o10.call(c5, g2);
          }, null, l6), f3 && b3.dispose(), b3;
        };
      }
      re.once = n6;
      function i8(d3, o10, c5) {
        return T2((l6, f3 = null, b3) => d3((g2) => l6.call(f3, o10(g2)), null, b3), c5);
      }
      re.map = i8;
      function s4(d3, o10, c5) {
        return T2((l6, f3 = null, b3) => d3((g2) => {
          o10(g2), l6.call(f3, g2);
        }, null, b3), c5);
      }
      re.forEach = s4;
      function a4(d3, o10, c5) {
        return T2((l6, f3 = null, b3) => d3((g2) => o10(g2) && l6.call(f3, g2), null, b3), c5);
      }
      re.filter = a4;
      function h4(d3) {
        return d3;
      }
      re.signal = h4;
      function u4(...d3) {
        return (o10, c5 = null, l6) => {
          let f3 = me(...d3.map((b3) => b3((g2) => o10.call(c5, g2))));
          return v2(f3, l6);
        };
      }
      re.any = u4;
      function p4(d3, o10, c5, l6) {
        let f3 = c5;
        return i8(d3, (b3) => (f3 = o10(f3, b3), f3), l6);
      }
      re.reduce = p4;
      function T2(d3, o10) {
        let c5, l6 = { onWillAddFirstListener() {
          c5 = d3(f3.fire, f3);
        }, onDidRemoveLastListener() {
          c5?.dispose();
        } };
        o10 || e10(l6);
        let f3 = new C2(l6);
        return o10?.add(f3), f3.event;
      }
      function v2(d3, o10) {
        return o10 instanceof Array ? o10.push(d3) : o10 && o10.add(d3), d3;
      }
      function I2(d3, o10, c5 = 100, l6 = false, f3 = false, b3, g2) {
        let w2, R2, U, se = 0, Z2, Ve = { leakWarningThreshold: b3, onWillAddFirstListener() {
          w2 = d3((dt) => {
            se++, R2 = o10(R2, dt), l6 && !U && (oe.fire(R2), R2 = void 0), Z2 = () => {
              let ht = R2;
              R2 = void 0, U = void 0, (!l6 || se > 1) && oe.fire(ht), se = 0;
            }, typeof c5 == "number" ? (clearTimeout(U), U = setTimeout(Z2, c5)) : U === void 0 && (U = 0, queueMicrotask(Z2));
          });
        }, onWillRemoveListener() {
          f3 && se > 0 && Z2?.();
        }, onDidRemoveLastListener() {
          Z2 = void 0, w2.dispose();
        } };
        g2 || e10(Ve);
        let oe = new C2(Ve);
        return g2?.add(oe), oe.event;
      }
      re.debounce = I2;
      function E2(d3, o10 = 0, c5) {
        return re.debounce(d3, (l6, f3) => l6 ? (l6.push(f3), l6) : [f3], o10, void 0, true, void 0, c5);
      }
      re.accumulate = E2;
      function S3(d3, o10 = (l6, f3) => l6 === f3, c5) {
        let l6 = true, f3;
        return a4(d3, (b3) => {
          let g2 = l6 || !o10(b3, f3);
          return l6 = false, f3 = b3, g2;
        }, c5);
      }
      re.latch = S3;
      function D2(d3, o10, c5) {
        return [re.filter(d3, o10, c5), re.filter(d3, (l6) => !o10(l6), c5)];
      }
      re.split = D2;
      function x2(d3, o10 = false, c5 = [], l6) {
        let f3 = c5.slice(), b3 = d3((R2) => {
          f3 ? f3.push(R2) : w2.fire(R2);
        });
        l6 && l6.add(b3);
        let g2 = () => {
          f3?.forEach((R2) => w2.fire(R2)), f3 = null;
        }, w2 = new C2({ onWillAddFirstListener() {
          b3 || (b3 = d3((R2) => w2.fire(R2)), l6 && l6.add(b3));
        }, onDidAddFirstListener() {
          f3 && (o10 ? setTimeout(g2) : g2());
        }, onDidRemoveLastListener() {
          b3 && b3.dispose(), b3 = null;
        } });
        return l6 && l6.add(w2), w2.event;
      }
      re.buffer = x2;
      function J(d3, o10) {
        return (l6, f3, b3) => {
          let g2 = o10(new z2());
          return d3(function(w2) {
            let R2 = g2.evaluate(w2);
            R2 !== q && l6.call(f3, R2);
          }, void 0, b3);
        };
      }
      re.chain = J;
      let q = /* @__PURE__ */ Symbol("HaltChainable");
      class z2 {
        constructor() {
          this.steps = [];
        }
        map(o10) {
          return this.steps.push(o10), this;
        }
        forEach(o10) {
          return this.steps.push((c5) => (o10(c5), c5)), this;
        }
        filter(o10) {
          return this.steps.push((c5) => o10(c5) ? c5 : q), this;
        }
        reduce(o10, c5) {
          let l6 = c5;
          return this.steps.push((f3) => (l6 = o10(l6, f3), l6)), this;
        }
        latch(o10 = (c5, l6) => c5 === l6) {
          let c5 = true, l6;
          return this.steps.push((f3) => {
            let b3 = c5 || !o10(f3, l6);
            return c5 = false, l6 = f3, b3 ? f3 : q;
          }), this;
        }
        evaluate(o10) {
          for (let c5 of this.steps) if (o10 = c5(o10), o10 === q) break;
          return o10;
        }
      }
      function m3(d3, o10, c5 = (l6) => l6) {
        let l6 = (...w2) => g2.fire(c5(...w2)), f3 = () => d3.on(o10, l6), b3 = () => d3.removeListener(o10, l6), g2 = new C2({ onWillAddFirstListener: f3, onDidRemoveLastListener: b3 });
        return g2.event;
      }
      re.fromNodeEventEmitter = m3;
      function _3(d3, o10, c5 = (l6) => l6) {
        let l6 = (...w2) => g2.fire(c5(...w2)), f3 = () => d3.addEventListener(o10, l6), b3 = () => d3.removeEventListener(o10, l6), g2 = new C2({ onWillAddFirstListener: f3, onDidRemoveLastListener: b3 });
        return g2.event;
      }
      re.fromDOMEventEmitter = _3;
      function y3(d3) {
        return new Promise((o10) => n6(d3)(o10));
      }
      re.toPromise = y3;
      function L2(d3) {
        let o10 = new C2();
        return d3.then((c5) => {
          o10.fire(c5);
        }, () => {
          o10.fire(void 0);
        }).finally(() => {
          o10.dispose();
        }), o10.event;
      }
      re.fromPromise = L2;
      function X(d3, o10) {
        return d3((c5) => o10.fire(c5));
      }
      re.forward = X;
      function Se(d3, o10, c5) {
        return o10(c5), d3((l6) => o10(l6));
      }
      re.runAndSubscribe = Se;
      class ct {
        constructor(o10, c5) {
          this._observable = o10;
          this._counter = 0;
          this._hasChanged = false;
          let l6 = { onWillAddFirstListener: () => {
            o10.addObserver(this);
          }, onDidRemoveLastListener: () => {
            o10.removeObserver(this);
          } };
          c5 || e10(l6), this.emitter = new C2(l6), c5 && c5.add(this.emitter);
        }
        beginUpdate(o10) {
          this._counter++;
        }
        handlePossibleChange(o10) {
        }
        handleChange(o10, c5) {
          this._hasChanged = true;
        }
        endUpdate(o10) {
          this._counter--, this._counter === 0 && (this._observable.reportChanges(), this._hasChanged && (this._hasChanged = false, this.emitter.fire(this._observable.get())));
        }
      }
      function zt(d3, o10) {
        return new ct(d3, o10).emitter.event;
      }
      re.fromObservable = zt;
      function Ut(d3) {
        return (o10, c5, l6) => {
          let f3 = 0, b3 = false, g2 = { beginUpdate() {
            f3++;
          }, endUpdate() {
            f3--, f3 === 0 && (d3.reportChanges(), b3 && (b3 = false, o10.call(c5)));
          }, handlePossibleChange() {
          }, handleChange() {
            b3 = true;
          } };
          d3.addObserver(g2), d3.reportChanges();
          let w2 = { dispose() {
            d3.removeObserver(g2);
          } };
          return l6 instanceof H2 ? l6.add(w2) : Array.isArray(l6) && l6.push(w2), w2;
        };
      }
      re.fromObservableLight = Ut;
    })(ie ||= {});
    B2 = class B3 {
      constructor(e10) {
        this.listenerCount = 0;
        this.invocationCount = 0;
        this.elapsedOverall = 0;
        this.durations = [];
        this.name = `${e10}_${B3._idPool++}`, B3.all.add(this);
      }
      start(e10) {
        this._stopWatch = new Te(), this.listenerCount = e10;
      }
      stop() {
        if (this._stopWatch) {
          let e10 = this._stopWatch.elapsed();
          this.durations.push(e10), this.elapsedOverall += e10, this.invocationCount += 1, this._stopWatch = void 0;
        }
      }
    };
    B2.all = /* @__PURE__ */ new Set(), B2._idPool = 0;
    Oe = B2;
    nt = -1;
    be = class be2 {
      constructor(e10, t6, n6 = (be2._idPool++).toString(16).padStart(3, "0")) {
        this._errorHandler = e10;
        this.threshold = t6;
        this.name = n6;
        this._warnCountdown = 0;
      }
      dispose() {
        this._stacks?.clear();
      }
      check(e10, t6) {
        let n6 = this.threshold;
        if (n6 <= 0 || t6 < n6) return;
        this._stacks || (this._stacks = /* @__PURE__ */ new Map());
        let i8 = this._stacks.get(e10.value) || 0;
        if (this._stacks.set(e10.value, i8 + 1), this._warnCountdown -= 1, this._warnCountdown <= 0) {
          this._warnCountdown = n6 * 0.5;
          let [s4, a4] = this.getMostFrequentStack(), h4 = `[${this.name}] potential listener LEAK detected, having ${t6} listeners already. MOST frequent listener (${a4}):`;
          console.warn(h4), console.warn(s4);
          let u4 = new Me(h4, s4);
          this._errorHandler(u4);
        }
        return () => {
          let s4 = this._stacks.get(e10.value) || 0;
          this._stacks.set(e10.value, s4 - 1);
        };
      }
      getMostFrequentStack() {
        if (!this._stacks) return;
        let e10, t6 = 0;
        for (let [n6, i8] of this._stacks) (!e10 || t6 < i8) && (e10 = [n6, i8], t6 = i8);
        return e10;
      }
    };
    be._idPool = 1;
    Ae = be;
    ne = class r4 {
      constructor(e10) {
        this.value = e10;
      }
      static create() {
        let e10 = new Error();
        return new r4(e10.stack ?? "");
      }
      print() {
        console.warn(this.value.split(`
`).slice(2).join(`
`));
      }
    };
    Me = class extends Error {
      constructor(e10, t6) {
        super(e10), this.name = "ListenerLeakError", this.stack = t6;
      }
    };
    Fe = class extends Error {
      constructor(e10, t6) {
        super(e10), this.name = "ListenerRefusalError", this.stack = t6;
      }
    };
    xt = 0;
    G = class {
      constructor(e10) {
        this.value = e10;
        this.id = xt++;
      }
    };
    It = 2;
    Dt = (r11, e10) => {
      if (r11 instanceof G) e10(r11);
      else for (let t6 = 0; t6 < r11.length; t6++) {
        let n6 = r11[t6];
        n6 && e10(n6);
      }
    };
    if (gt) {
      let r11 = [];
      setInterval(() => {
        r11.length !== 0 && (console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"), console.warn(r11.join(`
`)), r11.length = 0);
      }, 3e3), ve = new FinalizationRegistry((e10) => {
        typeof e10 == "string" && r11.push(e10);
      });
    }
    C2 = class {
      constructor(e10) {
        this._size = 0;
        this._options = e10, this._leakageMon = nt > 0 || this._options?.leakWarningThreshold ? new Ae(e10?.onListenerError ?? le, this._options?.leakWarningThreshold ?? nt) : void 0, this._perfMon = this._options?._profName ? new Oe(this._options._profName) : void 0, this._deliveryQueue = this._options?.deliveryQueue;
      }
      dispose() {
        if (!this._disposed) {
          if (this._disposed = true, this._deliveryQueue?.current === this && this._deliveryQueue.reset(), this._listeners) {
            if (tt) {
              let e10 = this._listeners;
              queueMicrotask(() => {
                Dt(e10, (t6) => t6.stack?.print());
              });
            }
            this._listeners = void 0, this._size = 0;
          }
          this._options?.onDidRemoveLastListener?.(), this._leakageMon?.dispose();
        }
      }
      get event() {
        return this._event ??= (e10, t6, n6) => {
          if (this._leakageMon && this._size > this._leakageMon.threshold ** 2) {
            let u4 = `[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;
            console.warn(u4);
            let p4 = this._leakageMon.getMostFrequentStack() ?? ["UNKNOWN stack", -1], T2 = new Fe(`${u4}. HINT: Stack shows most frequent listener (${p4[1]}-times)`, p4[0]);
            return (this._options?.onListenerError || le)(T2), k2.None;
          }
          if (this._disposed) return k2.None;
          t6 && (e10 = e10.bind(t6));
          let i8 = new G(e10), s4, a4;
          this._leakageMon && this._size >= Math.ceil(this._leakageMon.threshold * 0.2) && (i8.stack = ne.create(), s4 = this._leakageMon.check(i8.stack, this._size + 1)), tt && (i8.stack = a4 ?? ne.create()), this._listeners ? this._listeners instanceof G ? (this._deliveryQueue ??= new Ne(), this._listeners = [this._listeners, i8]) : this._listeners.push(i8) : (this._options?.onWillAddFirstListener?.(this), this._listeners = i8, this._options?.onDidAddFirstListener?.(this)), this._size++;
          let h4 = A2(() => {
            ve?.unregister(h4), s4?.(), this._removeListener(i8);
          });
          if (n6 instanceof H2 ? n6.add(h4) : Array.isArray(n6) && n6.push(h4), ve) {
            let u4 = new Error().stack.split(`
`).slice(2, 3).join(`
`).trim(), p4 = /(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(u4);
            ve.register(h4, p4?.[2] ?? u4, h4);
          }
          return h4;
        }, this._event;
      }
      _removeListener(e10) {
        if (this._options?.onWillRemoveListener?.(this), !this._listeners) return;
        if (this._size === 1) {
          this._listeners = void 0, this._options?.onDidRemoveLastListener?.(this), this._size = 0;
          return;
        }
        let t6 = this._listeners, n6 = t6.indexOf(e10);
        if (n6 === -1) throw console.log("disposed?", this._disposed), console.log("size?", this._size), console.log("arr?", JSON.stringify(this._listeners)), new Error("Attempted to dispose unknown listener");
        this._size--, t6[n6] = void 0;
        let i8 = this._deliveryQueue.current === this;
        if (this._size * It <= t6.length) {
          let s4 = 0;
          for (let a4 = 0; a4 < t6.length; a4++) t6[a4] ? t6[s4++] = t6[a4] : i8 && (this._deliveryQueue.end--, s4 < this._deliveryQueue.i && this._deliveryQueue.i--);
          t6.length = s4;
        }
      }
      _deliver(e10, t6) {
        if (!e10) return;
        let n6 = this._options?.onListenerError || le;
        if (!n6) {
          e10.value(t6);
          return;
        }
        try {
          e10.value(t6);
        } catch (i8) {
          n6(i8);
        }
      }
      _deliverQueue(e10) {
        let t6 = e10.current._listeners;
        for (; e10.i < e10.end; ) this._deliver(t6[e10.i++], e10.value);
        e10.reset();
      }
      fire(e10) {
        if (this._deliveryQueue?.current && (this._deliverQueue(this._deliveryQueue), this._perfMon?.stop()), this._perfMon?.start(this._size), this._listeners) if (this._listeners instanceof G) this._deliver(this._listeners, e10);
        else {
          let t6 = this._deliveryQueue;
          t6.enqueue(this, e10, this._listeners.length), this._deliverQueue(t6);
        }
        this._perfMon?.stop();
      }
      hasListeners() {
        return this._size > 0;
      }
    };
    Ne = class {
      constructor() {
        this.i = -1;
        this.end = 0;
      }
      enqueue(e10, t6, n6) {
        this.i = 0, this.end = n6, this.current = e10, this.value = t6;
      }
      reset() {
        this.i = this.end, this.current = void 0, this.value = void 0;
      }
    };
    it = Object.freeze(function(r11, e10) {
      let t6 = setTimeout(r11.bind(e10), 0);
      return { dispose() {
        clearTimeout(t6);
      } };
    });
    ((n6) => {
      function r11(i8) {
        return i8 === n6.None || i8 === n6.Cancelled || i8 instanceof We ? true : !i8 || typeof i8 != "object" ? false : typeof i8.isCancellationRequested == "boolean" && typeof i8.onCancellationRequested == "function";
      }
      n6.isCancellationToken = r11, n6.None = Object.freeze({ isCancellationRequested: false, onCancellationRequested: ie.None }), n6.Cancelled = Object.freeze({ isCancellationRequested: true, onCancellationRequested: it });
    })(Et ||= {});
    We = class {
      constructor() {
        this._isCancelled = false;
        this._emitter = null;
      }
      cancel() {
        this._isCancelled || (this._isCancelled = true, this._emitter && (this._emitter.fire(void 0), this.dispose()));
      }
      get isCancellationRequested() {
        return this._isCancelled;
      }
      get onCancellationRequested() {
        return this._isCancelled ? it : (this._emitter || (this._emitter = new C2()), this._emitter.event);
      }
      dispose() {
        this._emitter && (this._emitter.dispose(), this._emitter = null);
      }
    };
    Y = "en";
    qe = false;
    ze = false;
    ge = false;
    wt = false;
    kt = false;
    st = false;
    St = false;
    Rt = false;
    Ct = false;
    Pt = false;
    ye = Y;
    rt = Y;
    W = globalThis;
    typeof W.vscode < "u" && typeof W.vscode.process < "u" ? O = W.vscode.process : typeof process < "u" && typeof process?.versions?.node == "string" && (O = process);
    ot = typeof O?.versions?.electron == "string";
    Ot = ot && O?.type === "renderer";
    if (typeof O == "object") {
      qe = O.platform === "win32", ze = O.platform === "darwin", ge = O.platform === "linux", wt = ge && !!O.env.SNAP && !!O.env.SNAP_REVISION, St = ot, Ct = !!O.env.CI || !!O.env.BUILD_ARTIFACTSTAGINGDIRECTORY, _e = Y, ye = Y;
      let r11 = O.env.VSCODE_NLS_CONFIG;
      if (r11) try {
        let e10 = JSON.parse(r11);
        _e = e10.userLocale, rt = e10.osLocale, ye = e10.resolvedLanguage || Y, Lt = e10.languagePack?.translationsConfigFile;
      } catch {
      }
      kt = true;
    } else typeof navigator == "object" && !Ot ? (N2 = navigator.userAgent, qe = N2.indexOf("Windows") >= 0, ze = N2.indexOf("Macintosh") >= 0, Rt = (N2.indexOf("Macintosh") >= 0 || N2.indexOf("iPad") >= 0 || N2.indexOf("iPhone") >= 0) && !!navigator.maxTouchPoints && navigator.maxTouchPoints > 0, ge = N2.indexOf("Linux") >= 0, Pt = N2?.indexOf("Mobi") >= 0, st = true, ye = globalThis._VSCODE_NLS_LANGUAGE || Y, _e = navigator.language.toLowerCase(), rt = _e) : console.error("Unable to resolve platform.");
    je = 0;
    ze ? je = 1 : qe ? je = 3 : ge && (je = 2);
    At = st && typeof W.importScripts == "function";
    gn = At ? W.origin : void 0;
    M2 = N2;
    j2 = ye;
    ((n6) => {
      function r11() {
        return j2;
      }
      n6.value = r11;
      function e10() {
        return j2.length === 2 ? j2 === "en" : j2.length >= 3 ? j2[0] === "e" && j2[1] === "n" && j2[2] === "-" : false;
      }
      n6.isDefaultVariant = e10;
      function t6() {
        return j2 === "en";
      }
      n6.isDefault = t6;
    })(Mt ||= {});
    Ft = typeof W.postMessage == "function" && !W.importScripts;
    at = (() => {
      if (Ft) {
        let r11 = [];
        W.addEventListener("message", (t6) => {
          if (t6.data && t6.data.vscodeScheduleAsyncWork) for (let n6 = 0, i8 = r11.length; n6 < i8; n6++) {
            let s4 = r11[n6];
            if (s4.id === t6.data.vscodeScheduleAsyncWork) {
              r11.splice(n6, 1), s4.callback();
              return;
            }
          }
        });
        let e10 = 0;
        return (t6) => {
          let n6 = ++e10;
          r11.push({ id: n6, callback: t6 }), W.postMessage({ vscodeScheduleAsyncWork: n6 }, "*");
        };
      }
      return (r11) => setTimeout(r11);
    })();
    Nt = !!(M2 && M2.indexOf("Chrome") >= 0);
    yn = !!(M2 && M2.indexOf("Firefox") >= 0);
    xn = !!(!Nt && M2 && M2.indexOf("Safari") >= 0);
    In = !!(M2 && M2.indexOf("Edg/") >= 0);
    Dn = !!(M2 && M2.indexOf("Android") >= 0);
    (function() {
      typeof globalThis.requestIdleCallback != "function" || typeof globalThis.cancelIdleCallback != "function" ? Ue = (r11, e10) => {
        at(() => {
          if (t6) return;
          let n6 = Date.now() + 15;
          e10(Object.freeze({ didTimeout: true, timeRemaining() {
            return Math.max(0, n6 - Date.now());
          } }));
        });
        let t6 = false;
        return { dispose() {
          t6 || (t6 = true);
        } };
      } : Ue = (r11, e10, t6) => {
        let n6 = r11.requestIdleCallback(e10, typeof t6 == "number" ? { timeout: t6 } : void 0), i8 = false;
        return { dispose() {
          i8 || (i8 = true, r11.cancelIdleCallback(n6));
        } };
      }, jt = (r11) => Ue(globalThis, r11);
    })();
    ((t6) => {
      async function r11(n6) {
        let i8, s4 = await Promise.all(n6.map((a4) => a4.then((h4) => h4, (h4) => {
          i8 || (i8 = h4);
        })));
        if (typeof i8 < "u") throw i8;
        return s4;
      }
      t6.settled = r11;
      function e10(n6) {
        return new Promise(async (i8, s4) => {
          try {
            await n6(i8, s4);
          } catch (a4) {
            s4(a4);
          }
        });
      }
      t6.withAsyncBody = e10;
    })(qt ||= {});
    P2 = class P3 {
      static fromArray(e10) {
        return new P3((t6) => {
          t6.emitMany(e10);
        });
      }
      static fromPromise(e10) {
        return new P3(async (t6) => {
          t6.emitMany(await e10);
        });
      }
      static fromPromises(e10) {
        return new P3(async (t6) => {
          await Promise.all(e10.map(async (n6) => t6.emitOne(await n6)));
        });
      }
      static merge(e10) {
        return new P3(async (t6) => {
          await Promise.all(e10.map(async (n6) => {
            for await (let i8 of n6) t6.emitOne(i8);
          }));
        });
      }
      constructor(e10, t6) {
        this._state = 0, this._results = [], this._error = null, this._onReturn = t6, this._onStateChanged = new C2(), queueMicrotask(async () => {
          let n6 = { emitOne: (i8) => this.emitOne(i8), emitMany: (i8) => this.emitMany(i8), reject: (i8) => this.reject(i8) };
          try {
            await Promise.resolve(e10(n6)), this.resolve();
          } catch (i8) {
            this.reject(i8);
          } finally {
            n6.emitOne = void 0, n6.emitMany = void 0, n6.reject = void 0;
          }
        });
      }
      [Symbol.asyncIterator]() {
        let e10 = 0;
        return { next: async () => {
          do {
            if (this._state === 2) throw this._error;
            if (e10 < this._results.length) return { done: false, value: this._results[e10++] };
            if (this._state === 1) return { done: true, value: void 0 };
            await ie.toPromise(this._onStateChanged.event);
          } while (true);
        }, return: async () => (this._onReturn?.(), { done: true, value: void 0 }) };
      }
      static map(e10, t6) {
        return new P3(async (n6) => {
          for await (let i8 of e10) n6.emitOne(t6(i8));
        });
      }
      map(e10) {
        return P3.map(this, e10);
      }
      static filter(e10, t6) {
        return new P3(async (n6) => {
          for await (let i8 of e10) t6(i8) && n6.emitOne(i8);
        });
      }
      filter(e10) {
        return P3.filter(this, e10);
      }
      static coalesce(e10) {
        return P3.filter(e10, (t6) => !!t6);
      }
      coalesce() {
        return P3.coalesce(this);
      }
      static async toPromise(e10) {
        let t6 = [];
        for await (let n6 of e10) t6.push(n6);
        return t6;
      }
      toPromise() {
        return P3.toPromise(this);
      }
      emitOne(e10) {
        this._state === 0 && (this._results.push(e10), this._onStateChanged.fire());
      }
      emitMany(e10) {
        this._state === 0 && (this._results = this._results.concat(e10), this._onStateChanged.fire());
      }
      resolve() {
        this._state === 0 && (this._state = 1, this._onStateChanged.fire());
      }
      reject(e10) {
        this._state === 0 && (this._state = 2, this._error = e10, this._onStateChanged.fire());
      }
    };
    P2.EMPTY = P2.fromArray([]);
    Ie = class extends k2 {
      constructor(t6) {
        super();
        this._terminal = t6;
        this._linesCacheTimeout = this._register(new F());
        this._linesCacheDisposables = this._register(new F());
        this._register(A2(() => this._destroyLinesCache()));
      }
      initLinesCache() {
        this._linesCache || (this._linesCache = new Array(this._terminal.buffer.active.length), this._linesCacheDisposables.value = me(this._terminal.onLineFeed(() => this._destroyLinesCache()), this._terminal.onCursorMove(() => this._destroyLinesCache()), this._terminal.onResize(() => this._destroyLinesCache()))), this._linesCacheTimeout.value = xe(() => this._destroyLinesCache(), 15e3);
      }
      _destroyLinesCache() {
        this._linesCache = void 0, this._linesCacheDisposables.clear(), this._linesCacheTimeout.clear();
      }
      getLineFromCache(t6) {
        return this._linesCache?.[t6];
      }
      setLineInCache(t6, n6) {
        this._linesCache && (this._linesCache[t6] = n6);
      }
      translateBufferLineToStringWithWrap(t6, n6) {
        let i8 = [], s4 = [0], a4 = this._terminal.buffer.active.getLine(t6);
        for (; a4; ) {
          let h4 = this._terminal.buffer.active.getLine(t6 + 1), u4 = h4 ? h4.isWrapped : false, p4 = a4.translateToString(!u4 && n6);
          if (u4 && h4) {
            let T2 = a4.getCell(a4.length - 1);
            T2 && T2.getCode() === 0 && T2.getWidth() === 1 && h4.getCell(0)?.getWidth() === 2 && (p4 = p4.slice(0, -1));
          }
          if (i8.push(p4), u4) s4.push(s4[s4.length - 1] + p4.length);
          else break;
          t6++, a4 = h4;
        }
        return [i8.join(""), s4];
      }
    };
    De = class {
      get cachedSearchTerm() {
        return this._cachedSearchTerm;
      }
      set cachedSearchTerm(e10) {
        this._cachedSearchTerm = e10;
      }
      get lastSearchOptions() {
        return this._lastSearchOptions;
      }
      set lastSearchOptions(e10) {
        this._lastSearchOptions = e10;
      }
      isValidSearchTerm(e10) {
        return !!(e10 && e10.length > 0);
      }
      didOptionsChange(e10) {
        return this._lastSearchOptions ? e10 ? this._lastSearchOptions.caseSensitive !== e10.caseSensitive || this._lastSearchOptions.regex !== e10.regex || this._lastSearchOptions.wholeWord !== e10.wholeWord : false : true;
      }
      shouldUpdateHighlighting(e10, t6) {
        return t6?.decorations ? this._cachedSearchTerm === void 0 || e10 !== this._cachedSearchTerm || this.didOptionsChange(t6) : false;
      }
      clearCachedTerm() {
        this._cachedSearchTerm = void 0;
      }
      reset() {
        this._cachedSearchTerm = void 0, this._lastSearchOptions = void 0;
      }
    };
    Ee = class {
      constructor(e10, t6) {
        this._terminal = e10;
        this._lineCache = t6;
      }
      find(e10, t6, n6, i8) {
        if (!e10 || e10.length === 0) {
          this._terminal.clearSelection();
          return;
        }
        if (n6 > this._terminal.cols) throw new Error(`Invalid col: ${n6} to search in terminal of ${this._terminal.cols} cols`);
        this._lineCache.initLinesCache();
        let s4 = { startRow: t6, startCol: n6 }, a4 = this._findInLine(e10, s4, i8);
        if (!a4) for (let h4 = t6 + 1; h4 < this._terminal.buffer.active.baseY + this._terminal.rows && (s4.startRow = h4, s4.startCol = 0, a4 = this._findInLine(e10, s4, i8), !a4); h4++) ;
        return a4;
      }
      findNextWithSelection(e10, t6, n6) {
        if (!e10 || e10.length === 0) {
          this._terminal.clearSelection();
          return;
        }
        let i8 = this._terminal.getSelectionPosition();
        this._terminal.clearSelection();
        let s4 = 0, a4 = 0;
        i8 && (n6 === e10 ? (s4 = i8.end.x, a4 = i8.end.y) : (s4 = i8.start.x, a4 = i8.start.y)), this._lineCache.initLinesCache();
        let h4 = { startRow: a4, startCol: s4 }, u4 = this._findInLine(e10, h4, t6);
        if (!u4) for (let p4 = a4 + 1; p4 < this._terminal.buffer.active.baseY + this._terminal.rows && (h4.startRow = p4, h4.startCol = 0, u4 = this._findInLine(e10, h4, t6), !u4); p4++) ;
        if (!u4 && a4 !== 0) for (let p4 = 0; p4 < a4 && (h4.startRow = p4, h4.startCol = 0, u4 = this._findInLine(e10, h4, t6), !u4); p4++) ;
        return !u4 && i8 && (h4.startRow = i8.start.y, h4.startCol = 0, u4 = this._findInLine(e10, h4, t6)), u4;
      }
      findPreviousWithSelection(e10, t6, n6) {
        if (!e10 || e10.length === 0) {
          this._terminal.clearSelection();
          return;
        }
        let i8 = this._terminal.getSelectionPosition();
        this._terminal.clearSelection();
        let s4 = this._terminal.buffer.active.baseY + this._terminal.rows - 1, a4 = this._terminal.cols, h4 = true;
        this._lineCache.initLinesCache();
        let u4 = { startRow: s4, startCol: a4 }, p4;
        if (i8 && (u4.startRow = s4 = i8.start.y, u4.startCol = a4 = i8.start.x, n6 !== e10 && (p4 = this._findInLine(e10, u4, t6, false), p4 || (u4.startRow = s4 = i8.end.y, u4.startCol = a4 = i8.end.x))), p4 || (p4 = this._findInLine(e10, u4, t6, h4)), !p4) {
          u4.startCol = Math.max(u4.startCol, this._terminal.cols);
          for (let T2 = s4 - 1; T2 >= 0 && (u4.startRow = T2, p4 = this._findInLine(e10, u4, t6, h4), !p4); T2--) ;
        }
        if (!p4 && s4 !== this._terminal.buffer.active.baseY + this._terminal.rows - 1) for (let T2 = this._terminal.buffer.active.baseY + this._terminal.rows - 1; T2 >= s4 && (u4.startRow = T2, p4 = this._findInLine(e10, u4, t6, h4), !p4); T2--) ;
        return p4;
      }
      _isWholeWord(e10, t6, n6) {
        return (e10 === 0 || " ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t6[e10 - 1])) && (e10 + n6.length === t6.length || " ~!@#$%^&*()+`-=[]{}|\\;:\"',./<>?".includes(t6[e10 + n6.length]));
      }
      _findInLine(e10, t6, n6 = {}, i8 = false) {
        let s4 = t6.startRow, a4 = t6.startCol;
        if (this._terminal.buffer.active.getLine(s4)?.isWrapped) {
          if (i8) {
            t6.startCol += this._terminal.cols;
            return;
          }
          return t6.startRow--, t6.startCol += this._terminal.cols, this._findInLine(e10, t6, n6);
        }
        let u4 = this._lineCache.getLineFromCache(s4);
        u4 || (u4 = this._lineCache.translateBufferLineToStringWithWrap(s4, true), this._lineCache.setLineInCache(s4, u4));
        let [p4, T2] = u4, v2 = this._bufferColsToStringOffset(s4, a4), I2 = e10, E2 = p4;
        n6.regex || (I2 = n6.caseSensitive ? e10 : e10.toLowerCase(), E2 = n6.caseSensitive ? p4 : p4.toLowerCase());
        let S3 = -1;
        if (n6.regex) {
          let D2 = RegExp(I2, n6.caseSensitive ? "g" : "gi"), x2;
          if (i8) for (; x2 = D2.exec(E2.slice(0, v2)); ) S3 = D2.lastIndex - x2[0].length, e10 = x2[0], D2.lastIndex -= e10.length - 1;
          else x2 = D2.exec(E2.slice(v2)), x2 && x2[0].length > 0 && (S3 = v2 + (D2.lastIndex - x2[0].length), e10 = x2[0]);
        } else i8 ? v2 - I2.length >= 0 && (S3 = E2.lastIndexOf(I2, v2 - I2.length)) : S3 = E2.indexOf(I2, v2);
        if (S3 >= 0) {
          if (n6.wholeWord && !this._isWholeWord(S3, E2, e10)) return;
          let D2 = 0;
          for (; D2 < T2.length - 1 && S3 >= T2[D2 + 1]; ) D2++;
          let x2 = D2;
          for (; x2 < T2.length - 1 && S3 + e10.length >= T2[x2 + 1]; ) x2++;
          let J = S3 - T2[D2], q = S3 + e10.length - T2[x2], z2 = this._stringLengthToBufferSize(s4 + D2, J), _3 = this._stringLengthToBufferSize(s4 + x2, q) - z2 + this._terminal.cols * (x2 - D2);
          return { term: e10, col: z2, row: s4 + D2, size: _3 };
        }
      }
      _stringLengthToBufferSize(e10, t6) {
        let n6 = this._terminal.buffer.active.getLine(e10);
        if (!n6) return 0;
        for (let i8 = 0; i8 < t6; i8++) {
          let s4 = n6.getCell(i8);
          if (!s4) break;
          let a4 = s4.getChars();
          a4.length > 1 && (t6 -= a4.length - 1);
          let h4 = n6.getCell(i8 + 1);
          h4 && h4.getWidth() === 0 && t6++;
        }
        return t6;
      }
      _bufferColsToStringOffset(e10, t6) {
        let n6 = e10, i8 = 0, s4 = this._terminal.buffer.active.getLine(n6);
        for (; t6 > 0 && s4; ) {
          for (let a4 = 0; a4 < t6 && a4 < this._terminal.cols; a4++) {
            let h4 = s4.getCell(a4);
            if (!h4) break;
            h4.getWidth() && (i8 += h4.getCode() === 0 ? 1 : h4.getChars().length);
          }
          if (n6++, s4 = this._terminal.buffer.active.getLine(n6), s4 && !s4.isWrapped) break;
          t6 -= this._terminal.cols;
        }
        return i8;
      }
    };
    we = class extends k2 {
      constructor(t6) {
        super();
        this._terminal = t6;
        this._highlightDecorations = [];
        this._highlightedLines = /* @__PURE__ */ new Set();
        this._register(A2(() => this.clearHighlightDecorations()));
      }
      createHighlightDecorations(t6, n6) {
        this.clearHighlightDecorations();
        for (let i8 of t6) {
          let s4 = this._createResultDecorations(i8, n6, false);
          if (s4) for (let a4 of s4) this._storeDecoration(a4, i8);
        }
      }
      createActiveDecoration(t6, n6) {
        let i8 = this._createResultDecorations(t6, n6, true);
        if (i8) return { decorations: i8, match: t6, dispose() {
          Q(i8);
        } };
      }
      clearHighlightDecorations() {
        Q(this._highlightDecorations), this._highlightDecorations = [], this._highlightedLines.clear();
      }
      _storeDecoration(t6, n6) {
        this._highlightedLines.add(t6.marker.line), this._highlightDecorations.push({ decoration: t6, match: n6, dispose() {
          t6.dispose();
        } });
      }
      _applyStyles(t6, n6, i8) {
        t6.classList.contains("xterm-find-result-decoration") || (t6.classList.add("xterm-find-result-decoration"), n6 && (t6.style.outline = `1px solid ${n6}`)), i8 && t6.classList.add("xterm-find-active-result-decoration");
      }
      _createResultDecorations(t6, n6, i8) {
        let s4 = [], a4 = t6.col, h4 = t6.size, u4 = -this._terminal.buffer.active.baseY - this._terminal.buffer.active.cursorY + t6.row;
        for (; h4 > 0; ) {
          let T2 = Math.min(this._terminal.cols - a4, h4);
          s4.push([u4, a4, T2]), a4 = 0, h4 -= T2, u4++;
        }
        let p4 = [];
        for (let T2 of s4) {
          let v2 = this._terminal.registerMarker(T2[0]), I2 = this._terminal.registerDecoration({ marker: v2, x: T2[1], width: T2[2], backgroundColor: i8 ? n6.activeMatchBackground : n6.matchBackground, overviewRulerOptions: this._highlightedLines.has(v2.line) ? void 0 : { color: i8 ? n6.activeMatchColorOverviewRuler : n6.matchOverviewRuler, position: "center" } });
          if (I2) {
            let E2 = [];
            E2.push(v2), E2.push(I2.onRender((S3) => this._applyStyles(S3, i8 ? n6.activeMatchBorder : n6.matchBorder, false))), E2.push(I2.onDispose(() => Q(E2))), p4.push(I2);
          }
        }
        return p4.length === 0 ? void 0 : p4;
      }
    };
    ke = class extends k2 {
      constructor() {
        super(...arguments);
        this._searchResults = [];
        this._onDidChangeResults = this._register(new C2());
      }
      get onDidChangeResults() {
        return this._onDidChangeResults.event;
      }
      get searchResults() {
        return this._searchResults;
      }
      get selectedDecoration() {
        return this._selectedDecoration;
      }
      set selectedDecoration(t6) {
        this._selectedDecoration = t6;
      }
      updateResults(t6, n6) {
        this._searchResults = t6.slice(0, n6);
      }
      clearResults() {
        this._searchResults = [];
      }
      clearSelectedDecoration() {
        this._selectedDecoration && (this._selectedDecoration.dispose(), this._selectedDecoration = void 0);
      }
      findResultIndex(t6) {
        for (let n6 = 0; n6 < this._searchResults.length; n6++) {
          let i8 = this._searchResults[n6];
          if (i8.row === t6.row && i8.col === t6.col && i8.size === t6.size) return n6;
        }
        return -1;
      }
      fireResultsChanged(t6) {
        if (!t6) return;
        let n6 = -1;
        this._selectedDecoration && (n6 = this.findResultIndex(this._selectedDecoration.match)), this._onDidChangeResults.fire({ resultIndex: n6, resultCount: this._searchResults.length });
      }
      reset() {
        this.clearSelectedDecoration(), this.clearResults();
      }
    };
    ut = class extends k2 {
      constructor(t6) {
        super();
        this._highlightTimeout = this._register(new F());
        this._lineCache = this._register(new F());
        this._state = new De();
        this._resultTracker = this._register(new ke());
        this._highlightLimit = t6?.highlightLimit ?? 1e3;
      }
      get onDidChangeResults() {
        return this._resultTracker.onDidChangeResults;
      }
      activate(t6) {
        this._terminal = t6, this._lineCache.value = new Ie(t6), this._engine = new Ee(t6, this._lineCache.value), this._decorationManager = new we(t6), this._register(this._terminal.onWriteParsed(() => this._updateMatches())), this._register(this._terminal.onResize(() => this._updateMatches())), this._register(A2(() => this.clearDecorations()));
      }
      _updateMatches() {
        this._highlightTimeout.clear(), this._state.cachedSearchTerm && this._state.lastSearchOptions?.decorations && (this._highlightTimeout.value = xe(() => {
          let t6 = this._state.cachedSearchTerm;
          this._state.clearCachedTerm(), this.findPrevious(t6, { ...this._state.lastSearchOptions, incremental: true }, { noScroll: true });
        }, 200));
      }
      clearDecorations(t6) {
        this._resultTracker.clearSelectedDecoration(), this._decorationManager?.clearHighlightDecorations(), this._resultTracker.clearResults(), t6 || this._state.clearCachedTerm();
      }
      clearActiveDecoration() {
        this._resultTracker.clearSelectedDecoration();
      }
      findNext(t6, n6, i8) {
        if (!this._terminal || !this._engine) throw new Error("Cannot use addon until it has been loaded");
        this._state.lastSearchOptions = n6, this._state.shouldUpdateHighlighting(t6, n6) && this._highlightAllMatches(t6, n6);
        let s4 = this._findNextAndSelect(t6, n6, i8);
        return this._fireResults(n6), this._state.cachedSearchTerm = t6, s4;
      }
      _highlightAllMatches(t6, n6) {
        if (!this._terminal || !this._engine || !this._decorationManager) throw new Error("Cannot use addon until it has been loaded");
        if (!this._state.isValidSearchTerm(t6)) {
          this.clearDecorations();
          return;
        }
        this.clearDecorations(true);
        let i8 = [], s4, a4 = this._engine.find(t6, 0, 0, n6);
        for (; a4 && (s4?.row !== a4.row || s4?.col !== a4.col) && !(i8.length >= this._highlightLimit); ) s4 = a4, i8.push(s4), a4 = this._engine.find(t6, s4.col + s4.term.length >= this._terminal.cols ? s4.row + 1 : s4.row, s4.col + s4.term.length >= this._terminal.cols ? 0 : s4.col + 1, n6);
        this._resultTracker.updateResults(i8, this._highlightLimit), n6.decorations && this._decorationManager.createHighlightDecorations(i8, n6.decorations);
      }
      _findNextAndSelect(t6, n6, i8) {
        if (!this._terminal || !this._engine) return false;
        if (!this._state.isValidSearchTerm(t6)) return this._terminal.clearSelection(), this.clearDecorations(), false;
        let s4 = this._engine.findNextWithSelection(t6, n6, this._state.cachedSearchTerm);
        return this._selectResult(s4, n6?.decorations, i8?.noScroll);
      }
      findPrevious(t6, n6, i8) {
        if (!this._terminal || !this._engine) throw new Error("Cannot use addon until it has been loaded");
        this._state.lastSearchOptions = n6, this._state.shouldUpdateHighlighting(t6, n6) && this._highlightAllMatches(t6, n6);
        let s4 = this._findPreviousAndSelect(t6, n6, i8);
        return this._fireResults(n6), this._state.cachedSearchTerm = t6, s4;
      }
      _fireResults(t6) {
        this._resultTracker.fireResultsChanged(!!t6?.decorations);
      }
      _findPreviousAndSelect(t6, n6, i8) {
        if (!this._terminal || !this._engine) return false;
        if (!this._state.isValidSearchTerm(t6)) return this._terminal.clearSelection(), this.clearDecorations(), false;
        let s4 = this._engine.findPreviousWithSelection(t6, n6, this._state.cachedSearchTerm);
        return this._selectResult(s4, n6?.decorations, i8?.noScroll);
      }
      _selectResult(t6, n6, i8) {
        if (!this._terminal || !this._decorationManager) return false;
        if (this._resultTracker.clearSelectedDecoration(), !t6) return this._terminal.clearSelection(), false;
        if (this._terminal.select(t6.col, t6.row, t6.size), n6) {
          let s4 = this._decorationManager.createActiveDecoration(t6, n6);
          s4 && (this._resultTracker.selectedDecoration = s4);
        }
        if (!i8 && (t6.row >= this._terminal.buffer.active.viewportY + this._terminal.rows || t6.row < this._terminal.buffer.active.viewportY)) {
          let s4 = t6.row - this._terminal.buffer.active.viewportY;
          s4 -= Math.floor(this._terminal.rows / 2), this._terminal.scrollLines(s4);
        }
        return true;
      }
    };
  }
});

// node_modules/lit-html/lit-html.js
var t = globalThis;
var i = (t6) => t6;
var s = t.trustedTypes;
var e = s ? s.createPolicy("lit-html", { createHTML: (t6) => t6 }) : void 0;
var h = "$lit$";
var o = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n = "?" + o;
var r = `<${n}>`;
var l = document;
var c = () => l.createComment("");
var a = (t6) => null === t6 || "object" != typeof t6 && "function" != typeof t6;
var u = Array.isArray;
var d = (t6) => u(t6) || "function" == typeof t6?.[Symbol.iterator];
var f = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p = RegExp(`>|${f}(?:([^\\s"'>=/]+)(${f}*=${f}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y = /^(?:script|style|textarea|title)$/i;
var x = (t6) => (i8, ...s4) => ({ _$litType$: t6, strings: i8, values: s4 });
var b = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l.createTreeWalker(l, 129);
function V(t6, i8) {
  if (!u(t6) || !t6.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e ? e.createHTML(i8) : i8;
}
var N = (t6, i8) => {
  const s4 = t6.length - 1, e10 = [];
  let n6, l6 = 2 === i8 ? "<svg>" : 3 === i8 ? "<math>" : "", c5 = v;
  for (let i9 = 0; i9 < s4; i9++) {
    const s5 = t6[i9];
    let a4, u4, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c5.lastIndex = f3, u4 = c5.exec(s5), null !== u4); ) f3 = c5.lastIndex, c5 === v ? "!--" === u4[1] ? c5 = _ : void 0 !== u4[1] ? c5 = m : void 0 !== u4[2] ? (y.test(u4[2]) && (n6 = RegExp("</" + u4[2], "g")), c5 = p) : void 0 !== u4[3] && (c5 = p) : c5 === p ? ">" === u4[0] ? (c5 = n6 ?? v, d3 = -1) : void 0 === u4[1] ? d3 = -2 : (d3 = c5.lastIndex - u4[2].length, a4 = u4[1], c5 = void 0 === u4[3] ? p : '"' === u4[3] ? $ : g) : c5 === $ || c5 === g ? c5 = p : c5 === _ || c5 === m ? c5 = v : (c5 = p, n6 = void 0);
    const x2 = c5 === p && t6[i9 + 1].startsWith("/>") ? " " : "";
    l6 += c5 === v ? s5 + r : d3 >= 0 ? (e10.push(a4), s5.slice(0, d3) + h + s5.slice(d3) + o + x2) : s5 + o + (-2 === d3 ? i9 : x2);
  }
  return [V(t6, l6 + (t6[s4] || "<?>") + (2 === i8 ? "</svg>" : 3 === i8 ? "</math>" : "")), e10];
};
var S = class _S {
  constructor({ strings: t6, _$litType$: i8 }, e10) {
    let r11;
    this.parts = [];
    let l6 = 0, a4 = 0;
    const u4 = t6.length - 1, d3 = this.parts, [f3, v2] = N(t6, i8);
    if (this.el = _S.createElement(f3, e10), P.currentNode = this.el.content, 2 === i8 || 3 === i8) {
      const t7 = this.el.content.firstChild;
      t7.replaceWith(...t7.childNodes);
    }
    for (; null !== (r11 = P.nextNode()) && d3.length < u4; ) {
      if (1 === r11.nodeType) {
        if (r11.hasAttributes()) for (const t7 of r11.getAttributeNames()) if (t7.endsWith(h)) {
          const i9 = v2[a4++], s4 = r11.getAttribute(t7).split(o), e11 = /([.?@])?(.*)/.exec(i9);
          d3.push({ type: 1, index: l6, name: e11[2], strings: s4, ctor: "." === e11[1] ? I : "?" === e11[1] ? L : "@" === e11[1] ? z : H }), r11.removeAttribute(t7);
        } else t7.startsWith(o) && (d3.push({ type: 6, index: l6 }), r11.removeAttribute(t7));
        if (y.test(r11.tagName)) {
          const t7 = r11.textContent.split(o), i9 = t7.length - 1;
          if (i9 > 0) {
            r11.textContent = s ? s.emptyScript : "";
            for (let s4 = 0; s4 < i9; s4++) r11.append(t7[s4], c()), P.nextNode(), d3.push({ type: 2, index: ++l6 });
            r11.append(t7[i9], c());
          }
        }
      } else if (8 === r11.nodeType) if (r11.data === n) d3.push({ type: 2, index: l6 });
      else {
        let t7 = -1;
        for (; -1 !== (t7 = r11.data.indexOf(o, t7 + 1)); ) d3.push({ type: 7, index: l6 }), t7 += o.length - 1;
      }
      l6++;
    }
  }
  static createElement(t6, i8) {
    const s4 = l.createElement("template");
    return s4.innerHTML = t6, s4;
  }
};
function M(t6, i8, s4 = t6, e10) {
  if (i8 === E) return i8;
  let h4 = void 0 !== e10 ? s4._$Co?.[e10] : s4._$Cl;
  const o10 = a(i8) ? void 0 : i8._$litDirective$;
  return h4?.constructor !== o10 && (h4?._$AO?.(false), void 0 === o10 ? h4 = void 0 : (h4 = new o10(t6), h4._$AT(t6, s4, e10)), void 0 !== e10 ? (s4._$Co ??= [])[e10] = h4 : s4._$Cl = h4), void 0 !== h4 && (i8 = M(t6, h4._$AS(t6, i8.values), h4, e10)), i8;
}
var R = class {
  constructor(t6, i8) {
    this._$AV = [], this._$AN = void 0, this._$AD = t6, this._$AM = i8;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t6) {
    const { el: { content: i8 }, parts: s4 } = this._$AD, e10 = (t6?.creationScope ?? l).importNode(i8, true);
    P.currentNode = e10;
    let h4 = P.nextNode(), o10 = 0, n6 = 0, r11 = s4[0];
    for (; void 0 !== r11; ) {
      if (o10 === r11.index) {
        let i9;
        2 === r11.type ? i9 = new k(h4, h4.nextSibling, this, t6) : 1 === r11.type ? i9 = new r11.ctor(h4, r11.name, r11.strings, this, t6) : 6 === r11.type && (i9 = new Z(h4, this, t6)), this._$AV.push(i9), r11 = s4[++n6];
      }
      o10 !== r11?.index && (h4 = P.nextNode(), o10++);
    }
    return P.currentNode = l, e10;
  }
  p(t6) {
    let i8 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t6, s4, i8), i8 += s4.strings.length - 2) : s4._$AI(t6[i8])), i8++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t6, i8, s4, e10) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t6, this._$AB = i8, this._$AM = s4, this.options = e10, this._$Cv = e10?.isConnected ?? true;
  }
  get parentNode() {
    let t6 = this._$AA.parentNode;
    const i8 = this._$AM;
    return void 0 !== i8 && 11 === t6?.nodeType && (t6 = i8.parentNode), t6;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t6, i8 = this) {
    t6 = M(this, t6, i8), a(t6) ? t6 === A || null == t6 || "" === t6 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t6 !== this._$AH && t6 !== E && this._(t6) : void 0 !== t6._$litType$ ? this.$(t6) : void 0 !== t6.nodeType ? this.T(t6) : d(t6) ? this.k(t6) : this._(t6);
  }
  O(t6) {
    return this._$AA.parentNode.insertBefore(t6, this._$AB);
  }
  T(t6) {
    this._$AH !== t6 && (this._$AR(), this._$AH = this.O(t6));
  }
  _(t6) {
    this._$AH !== A && a(this._$AH) ? this._$AA.nextSibling.data = t6 : this.T(l.createTextNode(t6)), this._$AH = t6;
  }
  $(t6) {
    const { values: i8, _$litType$: s4 } = t6, e10 = "number" == typeof s4 ? this._$AC(t6) : (void 0 === s4.el && (s4.el = S.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e10) this._$AH.p(i8);
    else {
      const t7 = new R(e10, this), s5 = t7.u(this.options);
      t7.p(i8), this.T(s5), this._$AH = t7;
    }
  }
  _$AC(t6) {
    let i8 = C.get(t6.strings);
    return void 0 === i8 && C.set(t6.strings, i8 = new S(t6)), i8;
  }
  k(t6) {
    u(this._$AH) || (this._$AH = [], this._$AR());
    const i8 = this._$AH;
    let s4, e10 = 0;
    for (const h4 of t6) e10 === i8.length ? i8.push(s4 = new _k(this.O(c()), this.O(c()), this, this.options)) : s4 = i8[e10], s4._$AI(h4), e10++;
    e10 < i8.length && (this._$AR(s4 && s4._$AB.nextSibling, e10), i8.length = e10);
  }
  _$AR(t6 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t6 !== this._$AB; ) {
      const s5 = i(t6).nextSibling;
      i(t6).remove(), t6 = s5;
    }
  }
  setConnected(t6) {
    void 0 === this._$AM && (this._$Cv = t6, this._$AP?.(t6));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t6, i8, s4, e10, h4) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t6, this.name = i8, this._$AM = e10, this.options = h4, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t6, i8 = this, s4, e10) {
    const h4 = this.strings;
    let o10 = false;
    if (void 0 === h4) t6 = M(this, t6, i8, 0), o10 = !a(t6) || t6 !== this._$AH && t6 !== E, o10 && (this._$AH = t6);
    else {
      const e11 = t6;
      let n6, r11;
      for (t6 = h4[0], n6 = 0; n6 < h4.length - 1; n6++) r11 = M(this, e11[s4 + n6], i8, n6), r11 === E && (r11 = this._$AH[n6]), o10 ||= !a(r11) || r11 !== this._$AH[n6], r11 === A ? t6 = A : t6 !== A && (t6 += (r11 ?? "") + h4[n6 + 1]), this._$AH[n6] = r11;
    }
    o10 && !e10 && this.j(t6);
  }
  j(t6) {
    t6 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t6 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t6) {
    this.element[this.name] = t6 === A ? void 0 : t6;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t6) {
    this.element.toggleAttribute(this.name, !!t6 && t6 !== A);
  }
};
var z = class extends H {
  constructor(t6, i8, s4, e10, h4) {
    super(t6, i8, s4, e10, h4), this.type = 5;
  }
  _$AI(t6, i8 = this) {
    if ((t6 = M(this, t6, i8, 0) ?? A) === E) return;
    const s4 = this._$AH, e10 = t6 === A && s4 !== A || t6.capture !== s4.capture || t6.once !== s4.once || t6.passive !== s4.passive, h4 = t6 !== A && (s4 === A || e10);
    e10 && this.element.removeEventListener(this.name, this, s4), h4 && this.element.addEventListener(this.name, this, t6), this._$AH = t6;
  }
  handleEvent(t6) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t6) : this._$AH.handleEvent(t6);
  }
};
var Z = class {
  constructor(t6, i8, s4) {
    this.element = t6, this.type = 6, this._$AN = void 0, this._$AM = i8, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t6) {
    M(this, t6);
  }
};
var j = { M: h, P: o, A: n, C: 1, L: N, R, D: d, V: M, I: k, H, N: L, U: z, B: I, F: Z };
var B = t.litHtmlPolyfillSupport;
B?.(S, k), (t.litHtmlVersions ??= []).push("3.3.2");
var D = (t6, i8, s4) => {
  const e10 = s4?.renderBefore ?? i8;
  let h4 = e10._$litPart$;
  if (void 0 === h4) {
    const t7 = s4?.renderBefore ?? null;
    e10._$litPart$ = h4 = new k(i8.insertBefore(c(), t7), t7, void 0, s4 ?? {});
  }
  return h4._$AI(t6), h4;
};

// app/state.js
var LOG_CAP = 5e3;
function createStore(initial = {}) {
  let state = {
    activeRunId: initial.activeRunId ?? null,
    runs: initial.runs ?? {},
    logLines: initial.logLines ?? [],
    preferences: {
      theme: initial.preferences?.theme ?? "light",
      sidebarCollapsed: initial.preferences?.sidebarCollapsed ?? false
    }
  };
  const subs = /* @__PURE__ */ new Set();
  function emit() {
    for (const fn of Array.from(subs)) {
      try {
        fn(state);
      } catch {
      }
    }
  }
  return {
    getState() {
      return state;
    },
    setState(patch) {
      const next = {
        ...state,
        ...patch,
        preferences: { ...state.preferences, ...patch.preferences || {} }
      };
      if (next.activeRunId === state.activeRunId && next.runs === state.runs && next.logLines === state.logLines && next.preferences.theme === state.preferences.theme && next.preferences.sidebarCollapsed === state.preferences.sidebarCollapsed) return;
      state = next;
      emit();
    },
    setRun(runId, data) {
      const runs = { ...state.runs, [runId]: data };
      state = { ...state, runs };
      emit();
    },
    appendLog(entry) {
      const logLines = [...state.logLines, entry];
      if (logLines.length > LOG_CAP) logLines.splice(0, logLines.length - LOG_CAP);
      state = { ...state, logLines };
      emit();
    },
    clearLog() {
      state = { ...state, logLines: [] };
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}

// app/protocol.js
var MESSAGE_TYPES = [
  "subscribe-run",
  "unsubscribe-run",
  "subscribe-log",
  "unsubscribe-log",
  "list-runs",
  "get-preferences",
  "set-preferences",
  // Server → Client events
  "run-snapshot",
  "run-update",
  "runs-list",
  "log-line",
  "log-bulk",
  "preferences"
];
function nextId() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}
function makeRequest(type, payload, id3 = nextId()) {
  return { id: id3, type, payload };
}

// app/ws.js
function createWsClient(options = {}) {
  const backoff = {
    initialMs: options.backoff?.initialMs ?? 1e3,
    maxMs: options.backoff?.maxMs ?? 3e4,
    factor: options.backoff?.factor ?? 2,
    jitterRatio: options.backoff?.jitterRatio ?? 0.2
  };
  const resolveUrl = () => {
    if (options.url && options.url.length > 0) return options.url;
    if (typeof location !== "undefined") {
      return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    }
    return "ws://localhost/ws";
  };
  let ws2 = null;
  let state = "closed";
  let attempts = 0;
  let reconnectTimer = null;
  let shouldReconnect = true;
  const pending = /* @__PURE__ */ new Map();
  const queue = [];
  const handlers = /* @__PURE__ */ new Map();
  const connectionHandlers = /* @__PURE__ */ new Set();
  function notifyConnection(s4) {
    for (const fn of Array.from(connectionHandlers)) {
      try {
        fn(s4);
      } catch {
      }
    }
  }
  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer) return;
    state = "reconnecting";
    notifyConnection(state);
    const base = Math.min(backoff.maxMs, backoff.initialMs * Math.pow(backoff.factor, attempts));
    const jitter = backoff.jitterRatio * base;
    const delay = Math.max(0, Math.round(base + (Math.random() * 2 - 1) * jitter));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }
  function sendRaw(req) {
    try {
      ws2?.send(JSON.stringify(req));
    } catch {
    }
  }
  function onOpen() {
    state = "open";
    notifyConnection(state);
    attempts = 0;
    while (queue.length) {
      const req = queue.shift();
      if (req) sendRaw(req);
    }
  }
  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!msg || typeof msg.id !== "string" || typeof msg.type !== "string") return;
    if (pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) {
        entry?.resolve(msg.payload);
      } else {
        entry?.reject(msg.error || new Error("ws error"));
      }
      return;
    }
    const set = handlers.get(msg.type);
    if (set && set.size > 0) {
      for (const fn of Array.from(set)) {
        try {
          fn(msg.payload);
        } catch {
        }
      }
    }
  }
  function onClose() {
    state = "closed";
    notifyConnection(state);
    for (const [id3, p4] of pending.entries()) {
      p4.reject(new Error("ws disconnected"));
      pending.delete(id3);
    }
    attempts += 1;
    scheduleReconnect();
  }
  function connect() {
    if (!shouldReconnect) return;
    const url = resolveUrl();
    try {
      ws2 = new WebSocket(url);
      state = "connecting";
      notifyConnection(state);
      ws2.addEventListener("open", onOpen);
      ws2.addEventListener("message", onMessage);
      ws2.addEventListener("error", () => {
      });
      ws2.addEventListener("close", onClose);
    } catch {
      scheduleReconnect();
    }
  }
  connect();
  return {
    send(type, payload) {
      if (!MESSAGE_TYPES.includes(type)) {
        return Promise.reject(new Error(`unknown message type: ${type}`));
      }
      const id3 = nextId();
      const req = makeRequest(type, payload, id3);
      return new Promise((resolve, reject) => {
        pending.set(id3, { resolve, reject, type });
        if (ws2 && ws2.readyState === ws2.OPEN) {
          sendRaw(req);
        } else {
          queue.push(req);
        }
      });
    },
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, /* @__PURE__ */ new Set());
      const set = handlers.get(type);
      set?.add(handler);
      return () => {
        set?.delete(handler);
      };
    },
    onConnection(handler) {
      connectionHandlers.add(handler);
      return () => {
        connectionHandlers.delete(handler);
      };
    },
    close() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws2?.close();
      } catch {
      }
    },
    getState() {
      return state;
    }
  };
}

// app/router.js
function parseHash(hash) {
  const clean = (hash || "").replace(/^#\/?/, "");
  const [path, query] = clean.split("?");
  const section = path || "active";
  const params = new URLSearchParams(query || "");
  return { section, runId: params.get("run") || null };
}
function buildHash(section, runId) {
  const base = `#/${section}`;
  return runId ? `${base}?run=${runId}` : base;
}
function onHashChange(callback) {
  const handler = () => callback(parseHash(location.hash));
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
function navigate(section, runId) {
  location.hash = buildHash(section, runId);
}

// app/utils/theme.js
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// node_modules/lit-html/directive.js
var t2 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e2 = (t6) => (...e10) => ({ _$litDirective$: t6, values: e10 });
var i2 = class {
  constructor(t6) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t6, e10, i8) {
    this._$Ct = t6, this._$AM = e10, this._$Ci = i8;
  }
  _$AS(t6, e10) {
    return this.update(t6, e10);
  }
  update(t6, e10) {
    return this.render(...e10);
  }
};

// node_modules/lit-html/directives/unsafe-html.js
var e3 = class extends i2 {
  constructor(i8) {
    if (super(i8), this.it = A, i8.type !== t2.CHILD) throw Error(this.constructor.directiveName + "() can only be used in child bindings");
  }
  render(r11) {
    if (r11 === A || null == r11) return this._t = void 0, this.it = r11;
    if (r11 === E) return r11;
    if ("string" != typeof r11) throw Error(this.constructor.directiveName + "() called with a non-string value");
    if (r11 === this.it) return this._t;
    this.it = r11;
    const s4 = [r11];
    return s4.raw = s4, this._t = { _$litType$: this.constructor.resultType, strings: s4, values: [] };
  }
};
e3.directiveName = "unsafeHTML", e3.resultType = 1;
var o2 = e2(e3);

// node_modules/lucide/dist/esm/icons/circle.js
var Circle = [["circle", { cx: "12", cy: "12", r: "10" }]];

// node_modules/lucide/dist/esm/icons/circle-check.js
var CircleCheck = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "m9 12 2 2 4-4" }]
];

// node_modules/lucide/dist/esm/icons/circle-alert.js
var CircleAlert = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12" }],
  ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16" }]
];

// node_modules/lucide/dist/esm/icons/loader.js
var Loader = [
  ["path", { d: "M12 2v4" }],
  ["path", { d: "m16.2 7.8 2.9-2.9" }],
  ["path", { d: "M18 12h4" }],
  ["path", { d: "m16.2 16.2 2.9 2.9" }],
  ["path", { d: "M12 18v4" }],
  ["path", { d: "m4.9 19.1 2.9-2.9" }],
  ["path", { d: "M2 12h4" }],
  ["path", { d: "m4.9 4.9 2.9 2.9" }]
];

// node_modules/lucide/dist/esm/icons/refresh-cw.js
var RefreshCw = [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
  ["path", { d: "M21 3v5h-5" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
  ["path", { d: "M8 16H3v5" }]
];

// node_modules/lucide/dist/esm/icons/arrow-down.js
var ArrowDown = [
  ["path", { d: "M12 5v14" }],
  ["path", { d: "m19 12-7 7-7-7" }]
];

// node_modules/lucide/dist/esm/icons/pause.js
var Pause = [
  ["rect", { x: "14", y: "3", width: "5", height: "18", rx: "1" }],
  ["rect", { x: "5", y: "3", width: "5", height: "18", rx: "1" }]
];

// node_modules/lucide/dist/esm/icons/zap.js
var Zap = [
  [
    "path",
    {
      d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
    }
  ]
];

// node_modules/lucide/dist/esm/icons/clock.js
var Clock = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "M12 6v6l4 2" }]
];

// node_modules/lucide/dist/esm/icons/triangle-alert.js
var TriangleAlert = [
  ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
  ["path", { d: "M12 9v4" }],
  ["path", { d: "M12 17h.01" }]
];

// node_modules/lucide/dist/esm/icons/activity.js
var Activity = [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
    }
  ]
];

// node_modules/lucide/dist/esm/icons/archive.js
var Archive = [
  ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1" }],
  ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
  ["path", { d: "M10 12h4" }]
];

// node_modules/lucide/dist/esm/icons/search.js
var Search = [
  ["path", { d: "m21 21-4.34-4.34" }],
  ["circle", { cx: "11", cy: "11", r: "8" }]
];

// node_modules/lucide/dist/esm/icons/arrow-left.js
var ArrowLeft = [
  ["path", { d: "m12 19-7-7 7-7" }],
  ["path", { d: "M19 12H5" }]
];

// node_modules/lucide/dist/esm/icons/square.js
var Square = [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }]];

// node_modules/lucide/dist/esm/icons/play.js
var Play = [
  [
    "path",
    { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }
  ]
];

// node_modules/lucide/dist/esm/icons/users.js
var Users = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
  ["path", { d: "M16 3.128a4 4 0 0 1 0 7.744" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
  ["circle", { cx: "9", cy: "7", r: "4" }]
];

// node_modules/lucide/dist/esm/icons/shield.js
var Shield = [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
    }
  ]
];

// node_modules/lucide/dist/esm/icons/git-branch.js
var GitBranch = [
  ["path", { d: "M15 6a9 9 0 0 0-9 9V3" }],
  ["circle", { cx: "18", cy: "6", r: "3" }],
  ["circle", { cx: "6", cy: "18", r: "3" }]
];

// node_modules/lucide/dist/esm/icons/chevron-right.js
var ChevronRight = [["path", { d: "m9 18 6-6-6-6" }]];

// node_modules/lucide/dist/esm/icons/save.js
var Save = [
  [
    "path",
    {
      d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
    }
  ],
  ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }],
  ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }]
];

// node_modules/lucide/dist/esm/icons/settings.js
var Settings = [
  [
    "path",
    {
      d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3" }]
];

// node_modules/lucide/dist/esm/icons/timer.js
var Timer = [
  ["line", { x1: "10", x2: "14", y1: "2", y2: "2" }],
  ["line", { x1: "12", x2: "15", y1: "14", y2: "11" }],
  ["circle", { cx: "12", cy: "14", r: "8" }]
];

// node_modules/lucide/dist/esm/icons/cpu.js
var Cpu = [
  ["path", { d: "M12 20v2" }],
  ["path", { d: "M12 2v2" }],
  ["path", { d: "M17 20v2" }],
  ["path", { d: "M17 2v2" }],
  ["path", { d: "M2 12h2" }],
  ["path", { d: "M2 17h2" }],
  ["path", { d: "M2 7h2" }],
  ["path", { d: "M20 12h2" }],
  ["path", { d: "M20 17h2" }],
  ["path", { d: "M20 7h2" }],
  ["path", { d: "M7 20v2" }],
  ["path", { d: "M7 2v2" }],
  ["rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }],
  ["rect", { x: "8", y: "8", width: "8", height: "8", rx: "1" }]
];

// node_modules/lucide/dist/esm/icons/star.js
var Star = [
  [
    "path",
    {
      d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
    }
  ]
];

// app/utils/icons.js
function renderChildren(nodes) {
  return nodes.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k3, v2]) => `${k3}="${v2}"`).join(" ");
    return `<${tag} ${attrStr}/>`;
  }).join("");
}
function iconSvg(iconData, size3 = 16, className = "") {
  const cls = className ? ` class="${className}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size3}" height="${size3}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${cls}>${renderChildren(iconData)}</svg>`;
}

// app/views/sidebar.js
function sidebarView(state, route2, connectionState2, { onNavigate }) {
  const { runs, preferences } = state;
  const runList = Object.values(runs);
  const activeCount = runList.filter((r11) => r11.active).length;
  const historyCount = runList.filter((r11) => !r11.active).length;
  const connClass = connectionState2 === "open" ? "connected" : connectionState2 === "reconnecting" ? "reconnecting" : "disconnected";
  const connLabel = connectionState2 === "open" ? "Connected" : connectionState2 === "reconnecting" ? "Reconnecting\u2026" : "Disconnected";
  return b`
    <aside class="sidebar ${preferences.sidebarCollapsed ? "collapsed" : ""}">
      <div class="sidebar-logo" @click=${() => onNavigate("dashboard")} style="cursor:pointer">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${route2.section === "active" ? "active" : ""}"
             @click=${() => onNavigate("active")}>
          <span class="sidebar-item-left">
            ${o2(iconSvg(Activity, 16))}
            <span>Running</span>
          </span>
          ${activeCount > 0 ? b`<sl-badge variant="primary" pill>${activeCount}</sl-badge>` : ""}
        </div>
        <div class="sidebar-item ${route2.section === "history" ? "active" : ""}"
             @click=${() => onNavigate("history")}>
          <span class="sidebar-item-left">
            ${o2(iconSvg(Archive, 16))}
            <span>History</span>
          </span>
          ${historyCount > 0 ? b`<sl-badge variant="neutral" pill>${historyCount}</sl-badge>` : ""}
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="connection-indicator ${connClass}">
          <span class="conn-dot"></span>
          <span class="conn-label">${connLabel}</span>
        </div>
        <button
          class="theme-toggle-btn ${route2.section === "settings" ? "active" : ""}"
          aria-label="Settings"
          @click=${() => onNavigate("settings")}
        >${o2(iconSvg(Settings, 18))}</button>
      </div>
    </aside>
  `;
}

// app/utils/status-badge.js
var CLASS_MAP = {
  pending: "status-pending",
  in_progress: "status-in-progress",
  completed: "status-completed",
  error: "status-error",
  interrupted: "status-interrupted"
};
var ICON_DATA = {
  pending: Circle,
  in_progress: Loader,
  completed: CircleCheck,
  error: CircleAlert,
  interrupted: Pause
};
function resolveStatus(status, isActive) {
  if (status === "in_progress" && isActive === false) return "interrupted";
  return status;
}
function statusClass(status) {
  return CLASS_MAP[status] || "status-unknown";
}
function statusIcon(status, size3 = 14) {
  const data = ICON_DATA[status];
  if (!data) return "?";
  const className = status === "in_progress" ? "icon-spin" : "";
  return iconSvg(data, size3, className);
}

// app/views/stage-timeline.js
var STAGE_ICON = {
  pending: Circle,
  in_progress: Loader,
  completed: CircleCheck,
  error: CircleAlert,
  interrupted: Pause
};
function stageLabel(key, stageUi) {
  if (stageUi && stageUi[key]?.label) return stageUi[key].label;
  return key.replace(/_/g, " ").toUpperCase();
}
function stageTimelineView(stages, stageUi = {}, isActive = true) {
  if (!stages || typeof stages !== "object") return b``;
  const entries = Object.entries(stages);
  if (entries.length === 0) return b`<div class="empty-state">No stages</div>`;
  return b`
    <div class="stage-timeline">
      ${entries.map(([key, stage], i8) => {
    const status = resolveStatus(stage.status || "pending", isActive);
    const iconData = STAGE_ICON[status] || Circle;
    const label = stageLabel(key, stageUi);
    const isPulse = status === "in_progress";
    const iteration = stage.iteration;
    const iconClass = status === "in_progress" ? "icon-spin" : "";
    return b`
          ${i8 > 0 ? b`<div class="stage-connector ${entries[i8 - 1]?.[1]?.status === "completed" ? "completed" : ""}"></div>` : ""}
          <div class="stage-node ${statusClass(status)} ${isPulse ? "pulse" : ""}">
            <div class="stage-icon">${o2(iconSvg(iconData, 22, iconClass))}</div>
            <div class="stage-label">${label}</div>
            ${iteration > 1 ? b`<span class="loop-indicator">${o2(iconSvg(RefreshCw, 10))}${iteration}</span>` : ""}
          </div>
        `;
  })}
    </div>
  `;
}

// app/utils/duration.js
function formatDuration(ms) {
  const s4 = Math.floor(ms / 1e3);
  const h4 = Math.floor(s4 / 3600);
  const m3 = Math.floor(s4 % 3600 / 60);
  const sec = s4 % 60;
  if (h4 > 0) return `${h4}h ${m3}m ${sec}s`;
  if (m3 > 0) return `${m3}m ${sec}s`;
  return `${sec}s`;
}
function elapsed(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return end - start;
}
function formatTimestamp(iso) {
  if (!iso) return "N/A";
  const d3 = new Date(iso);
  const pad = (n6) => String(n6).padStart(2, "0");
  return `${d3.getFullYear()}.${pad(d3.getMonth() + 1)}.${pad(d3.getDate())} ${pad(d3.getHours())}:${pad(d3.getMinutes())}`;
}

// app/views/run-detail.js
function _lastStageEnd(stages) {
  if (!stages) return null;
  let latest = null;
  for (const s4 of Object.values(stages)) {
    if (s4.completed_at && (!latest || s4.completed_at > latest)) latest = s4.completed_at;
  }
  return latest;
}
function _badgeVariant(status) {
  if (status === "completed") return "success";
  if (status === "error") return "danger";
  if (status === "in_progress" || status === "interrupted") return "warning";
  return "neutral";
}
function _iterStatusIcon(iter) {
  const s4 = iter.status || "pending";
  if (s4 === "completed" && iter.outcome === "success") return b`<span class="iter-status-icon success">${o2(statusIcon("completed", 12))}</span>`;
  if (s4 === "completed") return b`<span class="iter-status-icon">${o2(statusIcon("completed", 12))}</span>`;
  if (s4 === "error") return b`<span class="iter-status-icon failure">${o2(statusIcon("error", 12))}</span>`;
  if (s4 === "in_progress") return b`<span class="iter-status-icon in-progress">${o2(statusIcon("in_progress", 12))}</span>`;
  return A;
}
function _triggerLabel(trigger) {
  if (!trigger) return A;
  const labels = {
    initial: "Initial run",
    test_failure: "Test failure",
    review_changes: "Review changes",
    restart_planning: "Restart planning"
  };
  return b`<span class="iteration-trigger">${labels[trigger] || trigger}</span>`;
}
function _outcomeLabel(outcome) {
  if (!outcome) return A;
  const cls = outcome === "success" ? "success" : "failure";
  return b`<span class="iteration-outcome ${cls}">${outcome.replace(/_/g, " ")}</span>`;
}
function timingStripView(startedAt, completedAt, extra = A) {
  const dur = startedAt ? formatDuration(elapsed(startedAt, completedAt || null)) : "";
  return b`
    <div class="timing-strip">
      ${startedAt ? b`<span class="timing-strip-item"><span class="meta-label">Started:</span> ${formatTimestamp(startedAt)}</span>` : A}
      ${completedAt ? b`<span class="timing-strip-item"><span class="meta-label">Finished:</span> ${formatTimestamp(completedAt)}</span>` : A}
      ${dur ? b`<span class="timing-strip-item"><span class="meta-label">Duration:</span> ${dur}</span>` : A}
      ${extra}
    </div>
  `;
}
function _iterationDetailView(iter, stageKey, stageAgent) {
  const agentName = iter.agent || stageAgent || stageKey;
  const model = iter.model || "";
  return b`
    <div class="iteration-detail">
      ${timingStripView(iter.started_at, iter.completed_at)}
      <div class="stage-info-strip">
        ${agentName ? b`<span class="stage-info-item"><span class="stage-meta-icon">${o2(iconSvg(Cpu, 12))}</span> ${agentName}${model ? b` <span class="text-muted">(${model})</span>` : ""}</span>` : A}
        ${iter.turns ? b`<span class="stage-info-item"><span class="meta-label">Turns:</span> ${iter.turns}</span>` : A}
        ${iter.cost_usd != null ? b`<span class="stage-info-item"><span class="meta-label">Cost:</span> $${Number(iter.cost_usd).toFixed(2)}</span>` : A}
      </div>
      ${iter.trigger ? b`<div class="detail-row">${_triggerLabel(iter.trigger)}</div>` : A}
      ${iter.outcome ? b`<div class="detail-row">${_outcomeLabel(iter.outcome)}</div>` : A}
    </div>
  `;
}
function runDetailView(run, settings2 = {}) {
  if (!run) {
    return b`<div class="empty-state">Select a run to view details</div>`;
  }
  const branch = run.branch || run.work_request?.branch || "";
  const pr = run.pr_url || null;
  const endTime = run.completed_at || (!run.active ? _lastStageEnd(run.stages) : null);
  const stages = run.stages || {};
  const stageUi = settings2.stageUi || {};
  const agents = settings2.agents || {};
  return b`
    <div class="run-detail">
      ${stageTimelineView(stages, stageUi, run.active)}

      <div class="run-info-section">
        ${branch ? b`
          <div class="run-branch">
            <span class="stage-meta-icon">${o2(iconSvg(GitBranch, 14))}</span>
            <span>${branch}</span>
            ${pr ? b`<a class="run-pr-link" href="${pr}" target="_blank">View PR</a>` : A}
          </div>
        ` : A}
        ${timingStripView(run.started_at, endTime)}
      </div>

      <div class="stage-panels">
        ${Object.entries(stages).map(([key, stage]) => {
    const label = stageUi[key]?.label || key.replace(/_/g, " ").toUpperCase();
    const stageStatus = resolveStatus(stage.status || "pending", run.active);
    const stageAgent = stage.agent || agents[key]?.agent || key;
    const stageModel = stage.model || agents[key]?.model || "";
    const stageDuration = stage.started_at ? formatDuration(elapsed(stage.started_at, stage.completed_at || null)) : "";
    const iterations = stage.iterations || [];
    const hasMultipleIterations = iterations.length > 1;
    return b`
            <sl-details ?open=${stageStatus === "in_progress"} class="stage-panel">
              <div slot="summary" class="stage-panel-header">
                <span class="stage-panel-icon ${statusClass(stageStatus)}">${o2(statusIcon(stageStatus))}</span>
                <span class="stage-panel-label">${label}</span>
                <span class="stage-panel-meta">
                  ${hasMultipleIterations ? b`
                    <span class="stage-meta-item stage-meta-iteration">
                      <span class="stage-meta-icon">${o2(iconSvg(RefreshCw, 11))}</span>
                      ${iterations.length} iterations
                    </span>
                  ` : A}
                  ${stage.completed_at ? b`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${o2(iconSvg(Clock, 11))}</span>
                      ${formatTimestamp(stage.completed_at)}
                    </span>
                  ` : A}
                  ${stageDuration ? b`
                    <span class="stage-meta-item">
                      <span class="stage-meta-icon">${o2(iconSvg(Timer, 11))}</span>
                      ${stageDuration}
                    </span>
                  ` : A}
                </span>
                <sl-badge variant="${_badgeVariant(stageStatus)}" pill>
                  ${stageStatus.replace(/_/g, " ")}
                </sl-badge>
              </div>
              ${hasMultipleIterations ? b`
                <sl-tab-group>
                  ${iterations.map((iter) => b`
                    <sl-tab slot="nav" panel="iter-${key}-${iter.number}">
                      Iter ${iter.number} ${_iterStatusIcon(iter)}
                    </sl-tab>
                  `)}
                  ${iterations.map((iter) => b`
                    <sl-tab-panel name="iter-${key}-${iter.number}">
                      ${_iterationDetailView(iter, key, stageAgent)}
                    </sl-tab-panel>
                  `)}
                </sl-tab-group>
              ` : b`
                <div class="stage-detail">
                  ${timingStripView(stage.started_at, stage.completed_at)}
                  <div class="stage-info-strip">
                    ${stageAgent ? b`<span class="stage-info-item"><span class="stage-meta-icon">${o2(iconSvg(Cpu, 12))}</span> ${stageAgent}${stageModel ? b` <span class="text-muted">(${stageModel})</span>` : ""}</span>` : A}
                    ${iterations.length === 1 && iterations[0].turns ? b`<span class="stage-info-item"><span class="meta-label">Turns:</span> ${iterations[0].turns}</span>` : A}
                    ${iterations.length === 1 && iterations[0].cost_usd != null ? b`<span class="stage-info-item"><span class="meta-label">Cost:</span> $${Number(iterations[0].cost_usd).toFixed(2)}</span>` : A}
                  </div>
                  ${iterations.length === 1 && iterations[0].trigger ? b`<div class="detail-row">${_triggerLabel(iterations[0].trigger)}</div>` : A}
                  ${iterations.length === 1 && iterations[0].outcome ? b`<div class="detail-row">${_outcomeLabel(iterations[0].outcome)}</div>` : A}
                  ${stage.task_progress ? b`<div class="detail-row"><span class="detail-label">Progress:</span> ${stage.task_progress}</div>` : A}
                  ${stage.error ? b`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${stage.error}</div>` : A}
                </div>
              `}
            </sl-details>
          `;
  })}
      </div>
    </div>
  `;
}

// app/views/run-card.js
var BADGE_VARIANT = {
  completed: "success",
  in_progress: "warning",
  error: "danger",
  interrupted: "warning",
  pending: "neutral"
};
function runCardView(run, { onClick } = {}) {
  const title = run.work_request?.title || "Untitled";
  const isActive = run.active;
  const overallStatus = isActive ? "in_progress" : run.stage === "error" ? "error" : "completed";
  const duration = run.started_at && run.completed_at ? formatDuration(elapsed(run.started_at, run.completed_at)) : run.started_at && isActive ? formatDuration(elapsed(run.started_at, null)) : "N/A";
  const branch = run.branch || run.work_request?.branch || "";
  const stages = run.stages ? Object.entries(run.stages) : [];
  return b`
    <div class="run-card" @click=${onClick ? () => onClick(run.id) : null}>
      <div class="run-card-top">
        <span class="run-card-status">${o2(statusIcon(overallStatus, 16))}</span>
        <span class="run-card-title">${title}</span>
      </div>
      ${branch ? b`<div class="run-card-meta"><span class="run-card-meta-item"><span class="meta-label">Branch:</span> ${branch}</span></div>` : A}
      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Started:</span> ${formatTimestamp(run.started_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Finished:</span> ${formatTimestamp(run.completed_at)}</span>
        <span class="run-card-meta-item"><span class="meta-label">Duration:</span> ${duration}</span>
      </div>
      ${stages.length > 0 ? b`
        <div class="run-card-stages">
          ${stages.map(([key, stage]) => {
    const status = resolveStatus(stage.status || "pending", isActive);
    const variant = BADGE_VARIANT[status] || "neutral";
    const label = key.replace(/_/g, " ").toUpperCase();
    return b`<sl-badge variant="${variant}" pill class="run-card-stage-badge">${label}</sl-badge>`;
  })}
        </div>
      ` : A}
    </div>
  `;
}

// app/views/run-list.js
function runListView(runs, filter, { onSelectRun }) {
  const filtered = runs.filter((r11) => filter === "active" ? r11.active : !r11.active);
  if (filtered.length === 0) {
    return b`<div class="empty-state">
      ${filter === "active" ? "No running pipelines" : "No completed runs yet"}
    </div>`;
  }
  return b`
    <div class="run-list">
      ${filtered.map((run) => runCardView(run, { onClick: onSelectRun }))}
    </div>
  `;
}

// app/views/dashboard.js
function dashboardView(state, { onSelectRun } = {}) {
  const runs = Object.values(state.runs);
  const active = runs.filter((r11) => r11.active);
  const completed = runs.filter((r11) => !r11.active);
  const errored = runs.filter((r11) => {
    const stages = r11.stages ? Object.values(r11.stages) : [];
    return stages.some((s4) => s4.status === "error");
  });
  const total = runs.length;
  return b`
    <div class="dashboard">
      <div class="dashboard-stats">
        <div class="stat-card stat-total">
          <div class="stat-icon-ring">${o2(iconSvg(Zap, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${total}</span>
            <span class="stat-label">Total Runs</span>
          </div>
        </div>
        <div class="stat-card stat-active">
          <div class="stat-icon-ring">${o2(iconSvg(Activity, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${active.length}</span>
            <span class="stat-label">Active</span>
          </div>
        </div>
        <div class="stat-card stat-completed">
          <div class="stat-icon-ring">${o2(iconSvg(CircleCheck, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${completed.length}</span>
            <span class="stat-label">Completed</span>
          </div>
        </div>
        <div class="stat-card stat-errors">
          <div class="stat-icon-ring">${o2(iconSvg(CircleAlert, 20))}</div>
          <div class="stat-body">
            <span class="stat-number">${errored.length}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
      </div>

      <h3 class="dashboard-section-title">Active Runs</h3>
      ${active.length > 0 ? b`
        <div class="run-list">
          ${active.map((run) => runCardView(run, { onClick: onSelectRun }))}
        </div>
      ` : b`<div class="empty-state">No running pipelines</div>`}
    </div>
  `;
}

// app/views/settings.js
var STAGE_AGENT_MAP = {
  plan: "planner",
  coordinate: "coordinator",
  implement: "implementer",
  test: "tester",
  review: "guardian",
  pr: "guardian"
};
var STAGE_ORDER = ["plan", "coordinate", "implement", "test", "review", "pr"];
var AGENT_NAMES = ["planner", "coordinator", "implementer", "tester", "guardian"];
var MODEL_OPTIONS = ["opus", "sonnet", "haiku"];
var DEFAULT_STAGES = {
  plan: { agent: "planner", enabled: true },
  coordinate: { agent: "coordinator", enabled: true },
  implement: { agent: "implementer", enabled: true },
  test: { agent: "tester", enabled: true },
  review: { agent: "guardian", enabled: true },
  pr: { agent: "guardian", enabled: true }
};
var GUARD_RULES = [
  { key: "block_rm_rf", label: "Block rm -rf", description: "Prevent recursive force-delete commands" },
  { key: "block_env_write", label: "Block .env writes", description: "Prevent writing to .env files" },
  { key: "block_force_push", label: "Block force push", description: "Prevent git push --force" },
  { key: "restrict_git_commit", label: "Restrict git commit", description: "Only guardian agent may commit" }
];
var DEFAULT_GOVERNANCE = {
  guards: { block_rm_rf: true, block_env_write: true, block_force_push: true, restrict_git_commit: true },
  test_gate_strikes: 2,
  dispatch: {
    planner: [],
    coordinator: ["implementer"],
    implementer: [],
    tester: [],
    guardian: []
  }
};
var settingsData = null;
var saveStatus = null;
var saveMessage = "";
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    settingsData = await res.json();
    if (!settingsData.worca) settingsData.worca = {};
    if (!settingsData.worca.stages) {
      settingsData.worca.stages = { ...DEFAULT_STAGES };
    } else {
      for (const stage of STAGE_ORDER) {
        if (!settingsData.worca.stages[stage]) {
          settingsData.worca.stages[stage] = { ...DEFAULT_STAGES[stage] };
        }
      }
    }
    if (!settingsData.worca.governance) {
      settingsData.worca.governance = { ...DEFAULT_GOVERNANCE };
    } else {
      settingsData.worca.governance = {
        ...DEFAULT_GOVERNANCE,
        ...settingsData.worca.governance,
        guards: { ...DEFAULT_GOVERNANCE.guards, ...settingsData.worca.governance.guards || {} },
        dispatch: { ...DEFAULT_GOVERNANCE.dispatch, ...settingsData.worca.governance.dispatch || {} }
      };
    }
  } catch (err) {
    settingsData = null;
    saveStatus = "error";
    saveMessage = "Failed to load settings: " + err.message;
  }
}
async function saveSettings(data, rerender2) {
  saveStatus = "saving";
  saveMessage = "";
  rerender2();
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    settingsData = { worca: result.worca, permissions: result.permissions };
    saveStatus = "success";
    saveMessage = "Settings saved successfully";
  } catch (err) {
    saveStatus = "error";
    saveMessage = "Failed to save: " + err.message;
  }
  rerender2();
  if (saveStatus === "success") {
    setTimeout(() => {
      if (saveStatus === "success") {
        saveStatus = null;
        saveMessage = "";
        rerender2();
      }
    }, 3e3);
  }
}
function readAgentsFromDom() {
  const agents = {};
  for (const name of AGENT_NAMES) {
    const modelEl = document.getElementById(`agent-${name}-model`);
    const turnsEl = document.getElementById(`agent-${name}-turns`);
    agents[name] = {
      model: modelEl?.value || "sonnet",
      max_turns: parseInt(turnsEl?.value, 10) || 30
    };
  }
  return agents;
}
function readPipelineFromDom() {
  const loops = {};
  for (const key of ["implement_test", "code_review", "pr_changes", "restart_planning"]) {
    const el = document.getElementById(`loop-${key}`);
    loops[key] = parseInt(el?.value, 10) || 0;
  }
  return { loops };
}
function readStagesFromDom() {
  const stages = {};
  for (const stage of STAGE_ORDER) {
    const enabledEl = document.getElementById(`stage-${stage}-enabled`);
    const agentEl = document.getElementById(`stage-${stage}-agent`);
    stages[stage] = {
      agent: agentEl?.value || DEFAULT_STAGES[stage].agent,
      enabled: enabledEl?.checked ?? true
    };
  }
  return stages;
}
function readGovernanceFromDom() {
  const guards = {};
  for (const rule of GUARD_RULES) {
    const el = document.getElementById(`guard-${rule.key}`);
    guards[rule.key] = el?.checked ?? true;
  }
  const strikeEl = document.getElementById("test-gate-strikes");
  const test_gate_strikes = parseInt(strikeEl?.value, 10) || 2;
  const dispatch = {};
  for (const agent of AGENT_NAMES) {
    const el = document.getElementById(`dispatch-${agent}`);
    const val = (el?.value || "").trim();
    dispatch[agent] = val ? val.split(",").map((s4) => s4.trim()).filter(Boolean) : [];
  }
  return { guards, test_gate_strikes, dispatch };
}
function agentsTab(worca, rerender2) {
  const agents = worca.agents || {};
  return b`
    <div class="settings-tab-content">
      <div class="settings-cards">
        ${AGENT_NAMES.map((name) => {
    const agent = agents[name] || {};
    return b`
            <div class="settings-card">
              <div class="settings-card-header">
                <span class="settings-card-icon">${o2(iconSvg(Users, 18))}</span>
                <span class="settings-card-title">${name}</span>
              </div>
              <div class="settings-card-body">
                <div class="settings-field">
                  <label class="settings-label">Model</label>
                  <sl-select id="agent-${name}-model" .value="${agent.model || "sonnet"}" size="small">
                    ${MODEL_OPTIONS.map((m3) => b`<sl-option value="${m3}">${m3}</sl-option>`)}
                  </sl-select>
                </div>
                <div class="settings-field">
                  <label class="settings-label">Max Turns</label>
                  <sl-input id="agent-${name}-turns" type="number" value="${agent.max_turns || 30}" size="small" min="1" max="200"></sl-input>
                </div>
              </div>
            </div>
          `;
  })}
      </div>
      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
    const agents2 = readAgentsFromDom();
    saveSettings({ worca: { ...settingsData.worca, agents: agents2 }, permissions: settingsData.permissions }, rerender2);
  }}>
          ${o2(iconSvg(Save, 14))}
          Save Agents
        </sl-button>
      </div>
    </div>
  `;
}
function pipelineTab(worca, rerender2) {
  const loops = worca.loops || {};
  const stages = worca.stages || DEFAULT_STAGES;
  return b`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Stage Configuration</h3>
      <div class="pipeline-flow">
        ${STAGE_ORDER.map((stage, i8) => {
    const stageConfig = stages[stage] || DEFAULT_STAGES[stage];
    const enabled = stageConfig.enabled !== false;
    return b`
            <div class="pipeline-stage-node ${enabled ? "pipeline-stage-node--enabled" : "pipeline-stage-node--disabled"}">
              <div class="pipeline-stage-header">
                <span class="pipeline-stage-name ${enabled ? "" : "pipeline-stage-name--disabled"}">${stage}</span>
                <sl-switch id="stage-${stage}-enabled" ?checked=${enabled} size="small"
                  @sl-change=${(e10) => {
      const node = e10.target.closest(".pipeline-stage-node");
      if (e10.target.checked) {
        node.classList.remove("pipeline-stage-node--disabled");
        node.classList.add("pipeline-stage-node--enabled");
        node.querySelector(".pipeline-stage-name").classList.remove("pipeline-stage-name--disabled");
      } else {
        node.classList.remove("pipeline-stage-node--enabled");
        node.classList.add("pipeline-stage-node--disabled");
        node.querySelector(".pipeline-stage-name").classList.add("pipeline-stage-name--disabled");
      }
    }}></sl-switch>
              </div>
              <div class="settings-field pipeline-stage-field">
                <label class="settings-label">Agent</label>
                <sl-select id="stage-${stage}-agent" .value="${stageConfig.agent || STAGE_AGENT_MAP[stage]}" size="small">
                  ${AGENT_NAMES.map((a4) => b`<sl-option value="${a4}">${a4}</sl-option>`)}
                </sl-select>
              </div>
            </div>
            ${i8 < STAGE_ORDER.length - 1 ? b`
              <span class="pipeline-arrow">${o2(iconSvg(ChevronRight, 16))}</span>
            ` : A}
          `;
  })}
      </div>

      <h3 class="settings-section-title">Loop Limits</h3>
      <div class="settings-grid">
        ${[
    { key: "implement_test", label: "Implement \u2194 Test" },
    { key: "code_review", label: "Code Review" },
    { key: "pr_changes", label: "PR Changes" },
    { key: "restart_planning", label: "Restart Planning" }
  ].map((item) => b`
          <div class="settings-field">
            <label class="settings-label">${item.label}</label>
            <sl-input id="loop-${item.key}" type="number" value="${loops[item.key] || 0}" size="small" min="0" max="50"></sl-input>
          </div>
        `)}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
    const { loops: loops2 } = readPipelineFromDom();
    const stages2 = readStagesFromDom();
    saveSettings({ worca: { ...settingsData.worca, loops: loops2, stages: stages2 }, permissions: settingsData.permissions }, rerender2);
  }}>
          ${o2(iconSvg(Save, 14))}
          Save Pipeline
        </sl-button>
      </div>
    </div>
  `;
}
function governanceTab(worca, permissions, rerender2) {
  const governance = worca.governance || DEFAULT_GOVERNANCE;
  const guards = governance.guards || DEFAULT_GOVERNANCE.guards;
  const dispatch = governance.dispatch || DEFAULT_GOVERNANCE.dispatch;
  const permList = permissions.allow || [];
  return b`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Guard Rules</h3>
      <div class="settings-switches">
        ${GUARD_RULES.map((rule) => b`
          <div class="settings-switch-row">
            <sl-switch id="guard-${rule.key}" ?checked=${guards[rule.key] !== false} size="small">
              ${rule.label}
            </sl-switch>
            <span class="settings-switch-desc">${rule.description}</span>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Test Gate</h3>
      <div class="settings-grid">
        <div class="settings-field">
          <label class="settings-label">Strike Threshold</label>
          <sl-input id="test-gate-strikes" type="number" value="${governance.test_gate_strikes || 2}" size="small" min="1" max="10"></sl-input>
          <span class="settings-field-hint">Consecutive test failures before blocking</span>
        </div>
      </div>

      <h3 class="settings-section-title">Dispatch Rules</h3>
      <div class="settings-dispatch-table">
        ${AGENT_NAMES.map((agent) => b`
          <div class="settings-dispatch-row">
            <span class="settings-dispatch-agent">${agent}</span>
            <sl-input id="dispatch-${agent}" value="${(dispatch[agent] || []).join(", ")}" size="small" placeholder="none"></sl-input>
          </div>
        `)}
      </div>

      <h3 class="settings-section-title">Permissions</h3>
      <div class="settings-permissions">
        ${permList.length > 0 ? permList.map((p4) => b`<div class="settings-perm-item"><code>${p4}</code></div>`) : b`<span class="settings-muted">No permissions configured</span>`}
      </div>

      <div class="settings-tab-actions">
        <sl-button variant="primary" size="small" @click=${() => {
    const governance2 = readGovernanceFromDom();
    saveSettings({ worca: { ...settingsData.worca, governance: governance2 }, permissions: settingsData.permissions }, rerender2);
  }}>
          ${o2(iconSvg(Save, 14))}
          Save Governance
        </sl-button>
      </div>
    </div>
  `;
}
function preferencesTab(preferences, onThemeToggle) {
  const theme = preferences?.theme || "light";
  return b`
    <div class="settings-tab-content">
      <h3 class="settings-section-title">Appearance</h3>
      <div class="settings-switches">
        <div class="settings-switch-row">
          <sl-switch ?checked=${theme === "dark"} size="small" @sl-change=${onThemeToggle}>Dark Mode</sl-switch>
          <span class="settings-switch-desc">Toggle between light and dark theme</span>
        </div>
      </div>
    </div>
  `;
}
function feedbackAlert(rerender2) {
  if (!saveStatus || saveStatus === "saving") return A;
  const variant = saveStatus === "success" ? "success" : "danger";
  return b`
    <div class="settings-toast">
      <sl-alert variant="${variant}" open closable duration="3000"
        @sl-after-hide=${() => {
    saveStatus = null;
    saveMessage = "";
    rerender2();
  }}>
        ${saveMessage}
      </sl-alert>
    </div>
  `;
}
function settingsView(preferences, { rerender: rerender2, onThemeToggle }) {
  if (!settingsData) {
    return b`<div class="empty-state">Loading settings\u2026</div>`;
  }
  const worca = settingsData.worca || {};
  const permissions = settingsData.permissions || {};
  return b`
    ${feedbackAlert(rerender2)}
    <div class="settings-page">
      <sl-tab-group>
        <sl-tab slot="nav" panel="agents">
          ${o2(iconSvg(Users, 14))}
          Agents
        </sl-tab>
        <sl-tab slot="nav" panel="pipeline">
          ${o2(iconSvg(GitBranch, 14))}
          Pipeline
        </sl-tab>
        <sl-tab slot="nav" panel="governance">
          ${o2(iconSvg(Shield, 14))}
          Governance
        </sl-tab>
        <sl-tab slot="nav" panel="preferences">
          ${o2(iconSvg(Settings, 14))}
          Preferences
        </sl-tab>

        <sl-tab-panel name="agents">${agentsTab(worca, rerender2)}</sl-tab-panel>
        <sl-tab-panel name="pipeline">${pipelineTab(worca, rerender2)}</sl-tab-panel>
        <sl-tab-panel name="governance">${governanceTab(worca, permissions, rerender2)}</sl-tab-panel>
        <sl-tab-panel name="preferences">${preferencesTab(preferences, onThemeToggle)}</sl-tab-panel>
      </sl-tab-group>
    </div>
  `;
}

// app/views/log-viewer.js
var STAGE_COLORS = [
  "\x1B[36m",
  // cyan
  "\x1B[33m",
  // yellow
  "\x1B[35m",
  // magenta
  "\x1B[32m",
  // green
  "\x1B[34m",
  // blue
  "\x1B[91m",
  // bright red
  "\x1B[96m",
  // bright cyan
  "\x1B[93m"
  // bright yellow
];
var RESET = "\x1B[0m";
var DIM = "\x1B[2m";
var stageColorCache = /* @__PURE__ */ new Map();
var colorIdx = 0;
function stageColor(stage) {
  if (!stageColorCache.has(stage)) {
    stageColorCache.set(stage, STAGE_COLORS[colorIdx % STAGE_COLORS.length]);
    colorIdx++;
  }
  return stageColorCache.get(stage);
}
var terminal = null;
var fitAddon = null;
var searchAddon = null;
var lastRunId = null;
var resizeObserver = null;
async function ensureTerminal(container) {
  if (terminal && container.querySelector(".xterm")) {
    fitAddon.fit();
    return;
  }
  const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
    Promise.resolve().then(() => __toESM(require_xterm(), 1)),
    Promise.resolve().then(() => (init_addon_fit(), addon_fit_exports)),
    Promise.resolve().then(() => (init_addon_search(), addon_search_exports))
  ]);
  terminal = new Terminal({
    theme: {
      background: "#0f172a",
      foreground: "#e2e8f0",
      cursor: "#60a5fa",
      selectionBackground: "rgba(96, 165, 250, 0.3)"
    },
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.4,
    scrollback: 5e4,
    convertEol: true,
    cursorBlink: false,
    disableStdin: true
  });
  fitAddon = new FitAddon();
  searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.open(container);
  fitAddon.fit();
  resizeObserver = new ResizeObserver(() => {
    if (fitAddon) fitAddon.fit();
  });
  resizeObserver.observe(container);
}
function writeLogLine(entry) {
  if (!terminal) return;
  const ts = entry.timestamp ? `${DIM}${entry.timestamp}${RESET} ` : "";
  const stage = entry.stage ? `${stageColor(entry.stage)}[${entry.stage.toUpperCase()}]${RESET} ` : "";
  const msg = entry.line || entry;
  terminal.writeln(`${ts}${stage}${msg}`);
}
function clearTerminal() {
  if (terminal) terminal.clear();
  stageColorCache.clear();
  colorIdx = 0;
}
function disposeTerminal() {
  if (resizeObserver) resizeObserver.disconnect();
  if (terminal) terminal.dispose();
  terminal = null;
  fitAddon = null;
  searchAddon = null;
  resizeObserver = null;
  lastRunId = null;
}
function searchTerminal(term) {
  if (searchAddon && term) {
    searchAddon.findNext(term, { incremental: true });
  }
}
async function mountTerminal(runId) {
  const container = document.getElementById("log-terminal");
  if (!container) return;
  if (runId !== lastRunId) {
    clearTerminal();
    lastRunId = runId;
  }
  await ensureTerminal(container);
}
function writeIterationSeparator(iterNum) {
  if (!terminal) return;
  terminal.writeln(`
${DIM}${"\u2500".repeat(40)} Iteration ${iterNum} ${"\u2500".repeat(40)}${RESET}
`);
}
function logViewerView(state, { onStageFilter, onIterationFilter, onSearch, onToggleAutoScroll, autoScroll: autoScroll2, stageIterations, runStages }) {
  const configStages = runStages ? ["orchestrator", ...Object.keys(runStages)] : null;
  const logStages = [.../* @__PURE__ */ new Set(["orchestrator", ...state.logLines.map((l6) => l6.stage).filter(Boolean)])];
  const stages = configStages || logStages;
  const currentStage = state.currentLogStage;
  const iterCount = stageIterations?.[currentStage] || 0;
  const showIterationSelector = currentStage && currentStage !== "*" && iterCount > 1;
  return b`
    <div class="log-viewer-container">
      <div class="log-controls">
        <sl-select
          placeholder="All Stages"
          size="small"
          clearable
          @sl-change=${(e10) => onStageFilter(e10.target.value || "*")}
        >
          ${stages.map((s4) => b`<sl-option value="${s4}">${s4 === "orchestrator" ? b`<span style="display:inline-flex;align-items:center;gap:4px">${o2(iconSvg(Star, 12))} ORCHESTRATOR</span>` : s4.toUpperCase()}</sl-option>`)}
        </sl-select>
        ${showIterationSelector ? b`
          <sl-select
            placeholder="All Iterations"
            size="small"
            clearable
            @sl-change=${(e10) => onIterationFilter(e10.target.value ? parseInt(e10.target.value) : null)}
          >
            ${Array.from(
    { length: iterCount },
    (_3, i8) => b`<sl-option value="${i8 + 1}">Iteration ${i8 + 1}</sl-option>`
  )}
          </sl-select>
        ` : A}
        <sl-input
          class="log-search"
          type="text"
          placeholder="Search logs\u2026"
          size="small"
          clearable
          @sl-input=${(e10) => onSearch(e10.target.value)}
        >
          <span slot="prefix">${o2(iconSvg(Search, 14))}</span>
        </sl-input>
        <sl-button
          size="small"
          variant="${autoScroll2 ? "primary" : "default"}"
          @click=${onToggleAutoScroll}
        >
          ${o2(iconSvg(autoScroll2 ? ArrowDown : Pause, 14))}
          ${autoScroll2 ? "Auto" : "Paused"}
        </sl-button>
      </div>
      <div class="log-terminal-wrapper">
        <div id="log-terminal" class="log-terminal"></div>
      </div>
    </div>
  `;
}

// node_modules/@lit/reactive-element/css-tag.js
var t3 = globalThis;
var e4 = t3.ShadowRoot && (void 0 === t3.ShadyCSS || t3.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s2 = /* @__PURE__ */ Symbol();
var o4 = /* @__PURE__ */ new WeakMap();
var n2 = class {
  constructor(t6, e10, o10) {
    if (this._$cssResult$ = true, o10 !== s2) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t6, this.t = e10;
  }
  get styleSheet() {
    let t6 = this.o;
    const s4 = this.t;
    if (e4 && void 0 === t6) {
      const e10 = void 0 !== s4 && 1 === s4.length;
      e10 && (t6 = o4.get(s4)), void 0 === t6 && ((this.o = t6 = new CSSStyleSheet()).replaceSync(this.cssText), e10 && o4.set(s4, t6));
    }
    return t6;
  }
  toString() {
    return this.cssText;
  }
};
var r5 = (t6) => new n2("string" == typeof t6 ? t6 : t6 + "", void 0, s2);
var i3 = (t6, ...e10) => {
  const o10 = 1 === t6.length ? t6[0] : e10.reduce((e11, s4, o11) => e11 + ((t7) => {
    if (true === t7._$cssResult$) return t7.cssText;
    if ("number" == typeof t7) return t7;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t7 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t6[o11 + 1], t6[0]);
  return new n2(o10, t6, s2);
};
var S2 = (s4, o10) => {
  if (e4) s4.adoptedStyleSheets = o10.map((t6) => t6 instanceof CSSStyleSheet ? t6 : t6.styleSheet);
  else for (const e10 of o10) {
    const o11 = document.createElement("style"), n6 = t3.litNonce;
    void 0 !== n6 && o11.setAttribute("nonce", n6), o11.textContent = e10.cssText, s4.appendChild(o11);
  }
};
var c2 = e4 ? (t6) => t6 : (t6) => t6 instanceof CSSStyleSheet ? ((t7) => {
  let e10 = "";
  for (const s4 of t7.cssRules) e10 += s4.cssText;
  return r5(e10);
})(t6) : t6;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i4, defineProperty: e5, getOwnPropertyDescriptor: h3, getOwnPropertyNames: r6, getOwnPropertySymbols: o5, getPrototypeOf: n3 } = Object;
var a2 = globalThis;
var c3 = a2.trustedTypes;
var l2 = c3 ? c3.emptyScript : "";
var p2 = a2.reactiveElementPolyfillSupport;
var d2 = (t6, s4) => t6;
var u2 = { toAttribute(t6, s4) {
  switch (s4) {
    case Boolean:
      t6 = t6 ? l2 : null;
      break;
    case Object:
    case Array:
      t6 = null == t6 ? t6 : JSON.stringify(t6);
  }
  return t6;
}, fromAttribute(t6, s4) {
  let i8 = t6;
  switch (s4) {
    case Boolean:
      i8 = null !== t6;
      break;
    case Number:
      i8 = null === t6 ? null : Number(t6);
      break;
    case Object:
    case Array:
      try {
        i8 = JSON.parse(t6);
      } catch (t7) {
        i8 = null;
      }
  }
  return i8;
} };
var f2 = (t6, s4) => !i4(t6, s4);
var b2 = { attribute: true, type: String, converter: u2, reflect: false, useDefault: false, hasChanged: f2 };
Symbol.metadata ??= /* @__PURE__ */ Symbol("metadata"), a2.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y2 = class extends HTMLElement {
  static addInitializer(t6) {
    this._$Ei(), (this.l ??= []).push(t6);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t6, s4 = b2) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t6) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t6, s4), !s4.noAccessor) {
      const i8 = /* @__PURE__ */ Symbol(), h4 = this.getPropertyDescriptor(t6, i8, s4);
      void 0 !== h4 && e5(this.prototype, t6, h4);
    }
  }
  static getPropertyDescriptor(t6, s4, i8) {
    const { get: e10, set: r11 } = h3(this.prototype, t6) ?? { get() {
      return this[s4];
    }, set(t7) {
      this[s4] = t7;
    } };
    return { get: e10, set(s5) {
      const h4 = e10?.call(this);
      r11?.call(this, s5), this.requestUpdate(t6, h4, i8);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t6) {
    return this.elementProperties.get(t6) ?? b2;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d2("elementProperties"))) return;
    const t6 = n3(this);
    t6.finalize(), void 0 !== t6.l && (this.l = [...t6.l]), this.elementProperties = new Map(t6.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d2("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d2("properties"))) {
      const t7 = this.properties, s4 = [...r6(t7), ...o5(t7)];
      for (const i8 of s4) this.createProperty(i8, t7[i8]);
    }
    const t6 = this[Symbol.metadata];
    if (null !== t6) {
      const s4 = litPropertyMetadata.get(t6);
      if (void 0 !== s4) for (const [t7, i8] of s4) this.elementProperties.set(t7, i8);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t7, s4] of this.elementProperties) {
      const i8 = this._$Eu(t7, s4);
      void 0 !== i8 && this._$Eh.set(i8, t7);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i8 = [];
    if (Array.isArray(s4)) {
      const e10 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e10) i8.unshift(c2(s5));
    } else void 0 !== s4 && i8.push(c2(s4));
    return i8;
  }
  static _$Eu(t6, s4) {
    const i8 = s4.attribute;
    return false === i8 ? void 0 : "string" == typeof i8 ? i8 : "string" == typeof t6 ? t6.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t6) => this.enableUpdating = t6), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t6) => t6(this));
  }
  addController(t6) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t6), void 0 !== this.renderRoot && this.isConnected && t6.hostConnected?.();
  }
  removeController(t6) {
    this._$EO?.delete(t6);
  }
  _$E_() {
    const t6 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i8 of s4.keys()) this.hasOwnProperty(i8) && (t6.set(i8, this[i8]), delete this[i8]);
    t6.size > 0 && (this._$Ep = t6);
  }
  createRenderRoot() {
    const t6 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S2(t6, this.constructor.elementStyles), t6;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t6) => t6.hostConnected?.());
  }
  enableUpdating(t6) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t6) => t6.hostDisconnected?.());
  }
  attributeChangedCallback(t6, s4, i8) {
    this._$AK(t6, i8);
  }
  _$ET(t6, s4) {
    const i8 = this.constructor.elementProperties.get(t6), e10 = this.constructor._$Eu(t6, i8);
    if (void 0 !== e10 && true === i8.reflect) {
      const h4 = (void 0 !== i8.converter?.toAttribute ? i8.converter : u2).toAttribute(s4, i8.type);
      this._$Em = t6, null == h4 ? this.removeAttribute(e10) : this.setAttribute(e10, h4), this._$Em = null;
    }
  }
  _$AK(t6, s4) {
    const i8 = this.constructor, e10 = i8._$Eh.get(t6);
    if (void 0 !== e10 && this._$Em !== e10) {
      const t7 = i8.getPropertyOptions(e10), h4 = "function" == typeof t7.converter ? { fromAttribute: t7.converter } : void 0 !== t7.converter?.fromAttribute ? t7.converter : u2;
      this._$Em = e10;
      const r11 = h4.fromAttribute(s4, t7.type);
      this[e10] = r11 ?? this._$Ej?.get(e10) ?? r11, this._$Em = null;
    }
  }
  requestUpdate(t6, s4, i8, e10 = false, h4) {
    if (void 0 !== t6) {
      const r11 = this.constructor;
      if (false === e10 && (h4 = this[t6]), i8 ??= r11.getPropertyOptions(t6), !((i8.hasChanged ?? f2)(h4, s4) || i8.useDefault && i8.reflect && h4 === this._$Ej?.get(t6) && !this.hasAttribute(r11._$Eu(t6, i8)))) return;
      this.C(t6, s4, i8);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t6, s4, { useDefault: i8, reflect: e10, wrapped: h4 }, r11) {
    i8 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t6) && (this._$Ej.set(t6, r11 ?? s4 ?? this[t6]), true !== h4 || void 0 !== r11) || (this._$AL.has(t6) || (this.hasUpdated || i8 || (s4 = void 0), this._$AL.set(t6, s4)), true === e10 && this._$Em !== t6 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t6));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t7) {
      Promise.reject(t7);
    }
    const t6 = this.scheduleUpdate();
    return null != t6 && await t6, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t8, s5] of this._$Ep) this[t8] = s5;
        this._$Ep = void 0;
      }
      const t7 = this.constructor.elementProperties;
      if (t7.size > 0) for (const [s5, i8] of t7) {
        const { wrapped: t8 } = i8, e10 = this[s5];
        true !== t8 || this._$AL.has(s5) || void 0 === e10 || this.C(s5, void 0, i8, e10);
      }
    }
    let t6 = false;
    const s4 = this._$AL;
    try {
      t6 = this.shouldUpdate(s4), t6 ? (this.willUpdate(s4), this._$EO?.forEach((t7) => t7.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t6 = false, this._$EM(), s5;
    }
    t6 && this._$AE(s4);
  }
  willUpdate(t6) {
  }
  _$AE(t6) {
    this._$EO?.forEach((t7) => t7.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t6)), this.updated(t6);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t6) {
    return true;
  }
  update(t6) {
    this._$Eq &&= this._$Eq.forEach((t7) => this._$ET(t7, this[t7])), this._$EM();
  }
  updated(t6) {
  }
  firstUpdated(t6) {
  }
};
y2.elementStyles = [], y2.shadowRootOptions = { mode: "open" }, y2[d2("elementProperties")] = /* @__PURE__ */ new Map(), y2[d2("finalized")] = /* @__PURE__ */ new Map(), p2?.({ ReactiveElement: y2 }), (a2.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i5 = class extends y2 {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t6 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t6.firstChild, t6;
  }
  update(t6) {
    const r11 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t6), this._$Do = D(r11, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i5._$litElement$ = true, i5["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i5 });
var o6 = s3.litElementPolyfillSupport;
o6?.({ LitElement: i5 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.J7PLVEQM.js
var details_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.KAW7D32O.js
var __defProp2 = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp2 = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a4, b3) => {
  for (var prop in b3 || (b3 = {}))
    if (__hasOwnProp2.call(b3, prop))
      __defNormalProp(a4, prop, b3[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b3)) {
      if (__propIsEnum.call(b3, prop))
        __defNormalProp(a4, prop, b3[prop]);
    }
  return a4;
};
var __spreadProps = (a4, b3) => __defProps(a4, __getOwnPropDescs(b3));
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc2(target, key) : target;
  for (var i8 = decorators.length - 1, decorator; i8 >= 0; i8--)
    if (decorator = decorators[i8])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp2(target, key, result);
  return result;
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __await = function(promise, isYieldStar) {
  this[0] = promise;
  this[1] = isYieldStar;
};
var __yieldStar = (value) => {
  var obj = value[__knownSymbol("asyncIterator")], isAwait = false, method, it2 = {};
  if (obj == null) {
    obj = value[__knownSymbol("iterator")]();
    method = (k3) => it2[k3] = (x2) => obj[k3](x2);
  } else {
    obj = obj.call(value);
    method = (k3) => it2[k3] = (v2) => {
      if (isAwait) {
        isAwait = false;
        if (k3 === "throw") throw v2;
        return v2;
      }
      isAwait = true;
      return {
        done: false,
        value: new __await(new Promise((resolve) => {
          var x2 = obj[k3](v2);
          if (!(x2 instanceof Object)) __typeError("Object expected");
          resolve(x2);
        }), 1)
      };
    };
  }
  return it2[__knownSymbol("iterator")] = () => it2, method("next"), "throw" in obj ? method("throw") : it2.throw = (x2) => {
    throw x2;
  }, "return" in obj && method("return"), it2;
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.K7JGTRV7.js
var defaultAnimationRegistry = /* @__PURE__ */ new Map();
var customAnimationRegistry = /* @__PURE__ */ new WeakMap();
function ensureAnimation(animation) {
  return animation != null ? animation : { keyframes: [], options: { duration: 0 } };
}
function getLogicalAnimation(animation, dir) {
  if (dir.toLowerCase() === "rtl") {
    return {
      keyframes: animation.rtlKeyframes || animation.keyframes,
      options: animation.options
    };
  }
  return animation;
}
function setDefaultAnimation(animationName, animation) {
  defaultAnimationRegistry.set(animationName, ensureAnimation(animation));
}
function getAnimation(el, animationName, options) {
  const customAnimation = customAnimationRegistry.get(el);
  if (customAnimation == null ? void 0 : customAnimation[animationName]) {
    return getLogicalAnimation(customAnimation[animationName], options.dir);
  }
  const defaultAnimation = defaultAnimationRegistry.get(animationName);
  if (defaultAnimation) {
    return getLogicalAnimation(defaultAnimation, options.dir);
  }
  return {
    keyframes: [],
    options: { duration: 0 }
  };
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.B4BZKR24.js
function waitForEvent(el, eventName) {
  return new Promise((resolve) => {
    function done(event) {
      if (event.target === el) {
        el.removeEventListener(eventName, done);
        resolve();
      }
    }
    el.addEventListener(eventName, done);
  });
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.AJ3ENQ5C.js
function animateTo(el, keyframes, options) {
  return new Promise((resolve) => {
    if ((options == null ? void 0 : options.duration) === Infinity) {
      throw new Error("Promise-based animations must be finite.");
    }
    const animation = el.animate(keyframes, __spreadProps(__spreadValues({}, options), {
      duration: prefersReducedMotion() ? 0 : options.duration
    }));
    animation.addEventListener("cancel", resolve, { once: true });
    animation.addEventListener("finish", resolve, { once: true });
  });
}
function parseDuration(delay) {
  delay = delay.toString().toLowerCase();
  if (delay.indexOf("ms") > -1) {
    return parseFloat(delay);
  }
  if (delay.indexOf("s") > -1) {
    return parseFloat(delay) * 1e3;
  }
  return parseFloat(delay);
}
function prefersReducedMotion() {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  return query.matches;
}
function stopAnimations(el) {
  return Promise.all(
    el.getAnimations().map((animation) => {
      return new Promise((resolve) => {
        animation.cancel();
        requestAnimationFrame(resolve);
      });
    })
  );
}
function shimKeyframesHeightAuto(keyframes, calculatedHeight) {
  return keyframes.map((keyframe) => __spreadProps(__spreadValues({}, keyframe), {
    height: keyframe.height === "auto" ? `${calculatedHeight}px` : keyframe.height
  }));
}

// node_modules/@shoelace-style/localize/dist/index.js
var connectedElements = /* @__PURE__ */ new Set();
var translations = /* @__PURE__ */ new Map();
var fallback;
var documentDirection = "ltr";
var documentLanguage = "en";
var isClient = typeof MutationObserver !== "undefined" && typeof document !== "undefined" && typeof document.documentElement !== "undefined";
if (isClient) {
  const documentElementObserver = new MutationObserver(update);
  documentDirection = document.documentElement.dir || "ltr";
  documentLanguage = document.documentElement.lang || navigator.language;
  documentElementObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dir", "lang"]
  });
}
function registerTranslation(...translation2) {
  translation2.map((t6) => {
    const code = t6.$code.toLowerCase();
    if (translations.has(code)) {
      translations.set(code, Object.assign(Object.assign({}, translations.get(code)), t6));
    } else {
      translations.set(code, t6);
    }
    if (!fallback) {
      fallback = t6;
    }
  });
  update();
}
function update() {
  if (isClient) {
    documentDirection = document.documentElement.dir || "ltr";
    documentLanguage = document.documentElement.lang || navigator.language;
  }
  [...connectedElements.keys()].map((el) => {
    if (typeof el.requestUpdate === "function") {
      el.requestUpdate();
    }
  });
}
var LocalizeController = class {
  constructor(host) {
    this.host = host;
    this.host.addController(this);
  }
  hostConnected() {
    connectedElements.add(this.host);
  }
  hostDisconnected() {
    connectedElements.delete(this.host);
  }
  dir() {
    return `${this.host.dir || documentDirection}`.toLowerCase();
  }
  lang() {
    return `${this.host.lang || documentLanguage}`.toLowerCase();
  }
  getTranslationData(lang) {
    var _a, _b;
    const locale = new Intl.Locale(lang.replace(/_/g, "-"));
    const language = locale === null || locale === void 0 ? void 0 : locale.language.toLowerCase();
    const region = (_b = (_a = locale === null || locale === void 0 ? void 0 : locale.region) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : "";
    const primary = translations.get(`${language}-${region}`);
    const secondary = translations.get(language);
    return { locale, language, region, primary, secondary };
  }
  exists(key, options) {
    var _a;
    const { primary, secondary } = this.getTranslationData((_a = options.lang) !== null && _a !== void 0 ? _a : this.lang());
    options = Object.assign({ includeFallback: false }, options);
    if (primary && primary[key] || secondary && secondary[key] || options.includeFallback && fallback && fallback[key]) {
      return true;
    }
    return false;
  }
  term(key, ...args) {
    const { primary, secondary } = this.getTranslationData(this.lang());
    let term;
    if (primary && primary[key]) {
      term = primary[key];
    } else if (secondary && secondary[key]) {
      term = secondary[key];
    } else if (fallback && fallback[key]) {
      term = fallback[key];
    } else {
      console.error(`No translation found for: ${String(key)}`);
      return String(key);
    }
    if (typeof term === "function") {
      return term(...args);
    }
    return term;
  }
  date(dateToFormat, options) {
    dateToFormat = new Date(dateToFormat);
    return new Intl.DateTimeFormat(this.lang(), options).format(dateToFormat);
  }
  number(numberToFormat, options) {
    numberToFormat = Number(numberToFormat);
    return isNaN(numberToFormat) ? "" : new Intl.NumberFormat(this.lang(), options).format(numberToFormat);
  }
  relativeTime(value, unit, options) {
    return new Intl.RelativeTimeFormat(this.lang(), options).format(value, unit);
  }
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.7BTDLTNI.js
var translation = {
  $code: "en",
  $name: "English",
  $dir: "ltr",
  carousel: "Carousel",
  clearEntry: "Clear entry",
  close: "Close",
  copied: "Copied",
  copy: "Copy",
  currentValue: "Current value",
  error: "Error",
  goToSlide: (slide, count) => `Go to slide ${slide} of ${count}`,
  hidePassword: "Hide password",
  loading: "Loading",
  nextSlide: "Next slide",
  numOptionsSelected: (num) => {
    if (num === 0) return "No options selected";
    if (num === 1) return "1 option selected";
    return `${num} options selected`;
  },
  previousSlide: "Previous slide",
  progress: "Progress",
  remove: "Remove",
  resize: "Resize",
  scrollToEnd: "Scroll to end",
  scrollToStart: "Scroll to start",
  selectAColorFromTheScreen: "Select a color from the screen",
  showPassword: "Show password",
  slideNum: (slide) => `Slide ${slide}`,
  toggleColorFormat: "Toggle color format"
};
registerTranslation(translation);
var en_default = translation;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.6CTB5ZDJ.js
var LocalizeController2 = class extends LocalizeController {
};
registerTranslation(en_default);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3Y6SB6QS.js
var basePath = "";
function setBasePath(path) {
  basePath = path;
}
function getBasePath(subpath = "") {
  if (!basePath) {
    const scripts = [...document.getElementsByTagName("script")];
    const configScript = scripts.find((script) => script.hasAttribute("data-shoelace"));
    if (configScript) {
      setBasePath(configScript.getAttribute("data-shoelace"));
    } else {
      const fallbackScript = scripts.find((s4) => {
        return /shoelace(\.min)?\.js($|\?)/.test(s4.src) || /shoelace-autoloader(\.min)?\.js($|\?)/.test(s4.src);
      });
      let path = "";
      if (fallbackScript) {
        path = fallbackScript.getAttribute("src");
      }
      setBasePath(path.split("/").slice(0, -1).join("/"));
    }
  }
  return basePath.replace(/\/$/, "") + (subpath ? `/${subpath.replace(/^\//, "")}` : ``);
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.P7ZG6EMR.js
var library = {
  name: "default",
  resolver: (name) => getBasePath(`assets/icons/${name}.svg`)
};
var library_default_default = library;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3TFKS637.js
var icons = {
  caret: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `,
  check: `
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
  `,
  "chevron-down": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-down" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
    </svg>
  `,
  "chevron-left": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-left" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
    </svg>
  `,
  "chevron-right": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-right" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  `,
  copy: `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-copy" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6ZM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z"/>
    </svg>
  `,
  eye: `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye" viewBox="0 0 16 16">
      <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
    </svg>
  `,
  "eye-slash": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye-slash" viewBox="0 0 16 16">
      <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
      <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
      <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
    </svg>
  `,
  eyedropper: `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eyedropper" viewBox="0 0 16 16">
      <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v1.793l-.854.853a.5.5 0 1 0 .708.707L1.707 15H3.5a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"></path>
    </svg>
  `,
  "grip-vertical": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-grip-vertical" viewBox="0 0 16 16">
      <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"></path>
    </svg>
  `,
  indeterminate: `
    <svg part="indeterminate-icon" class="checkbox__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" stroke-linecap="round">
        <g stroke="currentColor" stroke-width="2">
          <g transform="translate(2.285714, 6.857143)">
            <path d="M10.2857143,1.14285714 L1.14285714,1.14285714"></path>
          </g>
        </g>
      </g>
    </svg>
  `,
  "person-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-person-fill" viewBox="0 0 16 16">
      <path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
    </svg>
  `,
  "play-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
      <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"></path>
    </svg>
  `,
  "pause-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pause-fill" viewBox="0 0 16 16">
      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"></path>
    </svg>
  `,
  radio: `
    <svg part="checked-icon" class="radio__icon" viewBox="0 0 16 16">
      <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
        <g fill="currentColor">
          <circle cx="8" cy="8" r="3.42857143"></circle>
        </g>
      </g>
    </svg>
  `,
  "star-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
      <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
    </svg>
  `,
  "x-lg": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16">
      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
    </svg>
  `,
  "x-circle-fill": `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"></path>
    </svg>
  `
};
var systemLibrary = {
  name: "system",
  resolver: (name) => {
    if (name in icons) {
      return `data:image/svg+xml,${encodeURIComponent(icons[name])}`;
    }
    return "";
  }
};
var library_system_default = systemLibrary;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.ZL53POKZ.js
var registry = [library_default_default, library_system_default];
var watchedIcons = [];
function watchIcon(icon) {
  watchedIcons.push(icon);
}
function unwatchIcon(icon) {
  watchedIcons = watchedIcons.filter((el) => el !== icon);
}
function getIconLibrary(name) {
  return registry.find((lib) => lib.name === name);
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.QLXRCYS4.js
var icon_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GMYPQTFK.js
function watch(propertyName, options) {
  const resolvedOptions = __spreadValues({
    waitUntilFirstUpdate: false
  }, options);
  return (proto, decoratedFnName) => {
    const { update: update2 } = proto;
    const watchedProperties = Array.isArray(propertyName) ? propertyName : [propertyName];
    proto.update = function(changedProps) {
      watchedProperties.forEach((property) => {
        const key = property;
        if (changedProps.has(key)) {
          const oldValue = changedProps.get(key);
          const newValue = this[key];
          if (oldValue !== newValue) {
            if (!resolvedOptions.waitUntilFirstUpdate || this.hasUpdated) {
              this[decoratedFnName](oldValue, newValue);
            }
          }
        }
      });
      update2.call(this, changedProps);
    };
  };
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.TUVJKY7S.js
var component_styles_default = i3`
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
`;

// node_modules/@lit/reactive-element/decorators/property.js
var o7 = { attribute: true, type: String, converter: u2, reflect: false, hasChanged: f2 };
var r7 = (t6 = o7, e10, r11) => {
  const { kind: n6, metadata: i8 } = r11;
  let s4 = globalThis.litPropertyMetadata.get(i8);
  if (void 0 === s4 && globalThis.litPropertyMetadata.set(i8, s4 = /* @__PURE__ */ new Map()), "setter" === n6 && ((t6 = Object.create(t6)).wrapped = true), s4.set(r11.name, t6), "accessor" === n6) {
    const { name: o10 } = r11;
    return { set(r12) {
      const n7 = e10.get.call(this);
      e10.set.call(this, r12), this.requestUpdate(o10, n7, t6, true, r12);
    }, init(e11) {
      return void 0 !== e11 && this.C(o10, void 0, t6, e11), e11;
    } };
  }
  if ("setter" === n6) {
    const { name: o10 } = r11;
    return function(r12) {
      const n7 = this[o10];
      e10.call(this, r12), this.requestUpdate(o10, n7, t6, true, r12);
    };
  }
  throw Error("Unsupported decorator location: " + n6);
};
function n4(t6) {
  return (e10, o10) => "object" == typeof o10 ? r7(t6, e10, o10) : ((t7, e11, o11) => {
    const r11 = e11.hasOwnProperty(o11);
    return e11.constructor.createProperty(o11, t7), r11 ? Object.getOwnPropertyDescriptor(e11, o11) : void 0;
  })(t6, e10, o10);
}

// node_modules/@lit/reactive-element/decorators/state.js
function r8(r11) {
  return n4({ ...r11, state: true, attribute: false });
}

// node_modules/@lit/reactive-element/decorators/event-options.js
function t4(t6) {
  return (n6, o10) => {
    const c5 = "function" == typeof n6 ? n6 : n6[o10];
    Object.assign(c5, t6);
  };
}

// node_modules/@lit/reactive-element/decorators/base.js
var e6 = (e10, t6, c5) => (c5.configurable = true, c5.enumerable = true, Reflect.decorate && "object" != typeof t6 && Object.defineProperty(e10, t6, c5), c5);

// node_modules/@lit/reactive-element/decorators/query.js
function e7(e10, r11) {
  return (n6, s4, i8) => {
    const o10 = (t6) => t6.renderRoot?.querySelector(e10) ?? null;
    if (r11) {
      const { get: e11, set: r12 } = "object" == typeof s4 ? n6 : i8 ?? /* @__PURE__ */ (() => {
        const t6 = /* @__PURE__ */ Symbol();
        return { get() {
          return this[t6];
        }, set(e12) {
          this[t6] = e12;
        } };
      })();
      return e6(n6, s4, { get() {
        let t6 = e11.call(this);
        return void 0 === t6 && (t6 = o10(this), (null !== t6 || this.hasUpdated) && r12.call(this, t6)), t6;
      } });
    }
    return e6(n6, s4, { get() {
      return o10(this);
    } });
  };
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.4TUIT776.js
var _hasRecordedInitialProperties;
var ShoelaceElement = class extends i5 {
  constructor() {
    super();
    __privateAdd(this, _hasRecordedInitialProperties, false);
    this.initialReflectedProperties = /* @__PURE__ */ new Map();
    Object.entries(this.constructor.dependencies).forEach(([name, component]) => {
      this.constructor.define(name, component);
    });
  }
  emit(name, options) {
    const event = new CustomEvent(name, __spreadValues({
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {}
    }, options));
    this.dispatchEvent(event);
    return event;
  }
  /* eslint-enable */
  static define(name, elementConstructor = this, options = {}) {
    const currentlyRegisteredConstructor = customElements.get(name);
    if (!currentlyRegisteredConstructor) {
      try {
        customElements.define(name, elementConstructor, options);
      } catch (_err) {
        customElements.define(name, class extends elementConstructor {
        }, options);
      }
      return;
    }
    let newVersion = " (unknown version)";
    let existingVersion = newVersion;
    if ("version" in elementConstructor && elementConstructor.version) {
      newVersion = " v" + elementConstructor.version;
    }
    if ("version" in currentlyRegisteredConstructor && currentlyRegisteredConstructor.version) {
      existingVersion = " v" + currentlyRegisteredConstructor.version;
    }
    if (newVersion && existingVersion && newVersion === existingVersion) {
      return;
    }
    console.warn(
      `Attempted to register <${name}>${newVersion}, but <${name}>${existingVersion} has already been registered.`
    );
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (!__privateGet(this, _hasRecordedInitialProperties)) {
      this.constructor.elementProperties.forEach(
        (obj, prop) => {
          if (obj.reflect && this[prop] != null) {
            this.initialReflectedProperties.set(prop, this[prop]);
          }
        }
      );
      __privateSet(this, _hasRecordedInitialProperties, true);
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }
  willUpdate(changedProperties) {
    super.willUpdate(changedProperties);
    this.initialReflectedProperties.forEach((value, prop) => {
      if (changedProperties.has(prop) && this[prop] == null) {
        this[prop] = value;
      }
    });
  }
};
_hasRecordedInitialProperties = /* @__PURE__ */ new WeakMap();
ShoelaceElement.version = "2.20.1";
ShoelaceElement.dependencies = {};
__decorateClass([
  n4()
], ShoelaceElement.prototype, "dir", 2);
__decorateClass([
  n4()
], ShoelaceElement.prototype, "lang", 2);

// node_modules/lit-html/directive-helpers.js
var { I: t5 } = j;
var l3 = (o10, t6) => void 0 === t6 ? void 0 !== o10?._$litType$ : o10?._$litType$ === t6;
var r9 = (o10) => void 0 === o10.strings;
var m2 = {};
var p3 = (o10, t6 = m2) => o10._$AH = t6;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.YHLNUJ7P.js
var CACHEABLE_ERROR = /* @__PURE__ */ Symbol();
var RETRYABLE_ERROR = /* @__PURE__ */ Symbol();
var parser;
var iconCache = /* @__PURE__ */ new Map();
var SlIcon = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.initialRender = false;
    this.svg = null;
    this.label = "";
    this.library = "default";
  }
  /** Given a URL, this function returns the resulting SVG element or an appropriate error symbol. */
  async resolveIcon(url, library2) {
    var _a;
    let fileData;
    if (library2 == null ? void 0 : library2.spriteSheet) {
      this.svg = b`<svg part="svg">
        <use part="use" href="${url}"></use>
      </svg>`;
      return this.svg;
    }
    try {
      fileData = await fetch(url, { mode: "cors" });
      if (!fileData.ok) return fileData.status === 410 ? CACHEABLE_ERROR : RETRYABLE_ERROR;
    } catch (e10) {
      return RETRYABLE_ERROR;
    }
    try {
      const div = document.createElement("div");
      div.innerHTML = await fileData.text();
      const svg = div.firstElementChild;
      if (((_a = svg == null ? void 0 : svg.tagName) == null ? void 0 : _a.toLowerCase()) !== "svg") return CACHEABLE_ERROR;
      if (!parser) parser = new DOMParser();
      const doc = parser.parseFromString(svg.outerHTML, "text/html");
      const svgEl = doc.body.querySelector("svg");
      if (!svgEl) return CACHEABLE_ERROR;
      svgEl.part.add("svg");
      return document.adoptNode(svgEl);
    } catch (e10) {
      return CACHEABLE_ERROR;
    }
  }
  connectedCallback() {
    super.connectedCallback();
    watchIcon(this);
  }
  firstUpdated() {
    this.initialRender = true;
    this.setIcon();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    unwatchIcon(this);
  }
  getIconSource() {
    const library2 = getIconLibrary(this.library);
    if (this.name && library2) {
      return {
        url: library2.resolver(this.name),
        fromLibrary: true
      };
    }
    return {
      url: this.src,
      fromLibrary: false
    };
  }
  handleLabelChange() {
    const hasLabel = typeof this.label === "string" && this.label.length > 0;
    if (hasLabel) {
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", this.label);
      this.removeAttribute("aria-hidden");
    } else {
      this.removeAttribute("role");
      this.removeAttribute("aria-label");
      this.setAttribute("aria-hidden", "true");
    }
  }
  async setIcon() {
    var _a;
    const { url, fromLibrary } = this.getIconSource();
    const library2 = fromLibrary ? getIconLibrary(this.library) : void 0;
    if (!url) {
      this.svg = null;
      return;
    }
    let iconResolver = iconCache.get(url);
    if (!iconResolver) {
      iconResolver = this.resolveIcon(url, library2);
      iconCache.set(url, iconResolver);
    }
    if (!this.initialRender) {
      return;
    }
    const svg = await iconResolver;
    if (svg === RETRYABLE_ERROR) {
      iconCache.delete(url);
    }
    if (url !== this.getIconSource().url) {
      return;
    }
    if (l3(svg)) {
      this.svg = svg;
      if (library2) {
        await this.updateComplete;
        const shadowSVG = this.shadowRoot.querySelector("[part='svg']");
        if (typeof library2.mutator === "function" && shadowSVG) {
          library2.mutator(shadowSVG);
        }
      }
      return;
    }
    switch (svg) {
      case RETRYABLE_ERROR:
      case CACHEABLE_ERROR:
        this.svg = null;
        this.emit("sl-error");
        break;
      default:
        this.svg = svg.cloneNode(true);
        (_a = library2 == null ? void 0 : library2.mutator) == null ? void 0 : _a.call(library2, this.svg);
        this.emit("sl-load");
    }
  }
  render() {
    return this.svg;
  }
};
SlIcon.styles = [component_styles_default, icon_styles_default];
__decorateClass([
  r8()
], SlIcon.prototype, "svg", 2);
__decorateClass([
  n4({ reflect: true })
], SlIcon.prototype, "name", 2);
__decorateClass([
  n4()
], SlIcon.prototype, "src", 2);
__decorateClass([
  n4()
], SlIcon.prototype, "label", 2);
__decorateClass([
  n4({ reflect: true })
], SlIcon.prototype, "library", 2);
__decorateClass([
  watch("label")
], SlIcon.prototype, "handleLabelChange", 1);
__decorateClass([
  watch(["name", "src", "library"])
], SlIcon.prototype, "setIcon", 1);

// node_modules/lit-html/directives/class-map.js
var e8 = e2(class extends i2 {
  constructor(t6) {
    if (super(t6), t6.type !== t2.ATTRIBUTE || "class" !== t6.name || t6.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
  }
  render(t6) {
    return " " + Object.keys(t6).filter((s4) => t6[s4]).join(" ") + " ";
  }
  update(s4, [i8]) {
    if (void 0 === this.st) {
      this.st = /* @__PURE__ */ new Set(), void 0 !== s4.strings && (this.nt = new Set(s4.strings.join(" ").split(/\s/).filter((t6) => "" !== t6)));
      for (const t6 in i8) i8[t6] && !this.nt?.has(t6) && this.st.add(t6);
      return this.render(i8);
    }
    const r11 = s4.element.classList;
    for (const t6 of this.st) t6 in i8 || (r11.remove(t6), this.st.delete(t6));
    for (const t6 in i8) {
      const s5 = !!i8[t6];
      s5 === this.st.has(t6) || this.nt?.has(t6) || (s5 ? (r11.add(t6), this.st.add(t6)) : (r11.remove(t6), this.st.delete(t6)));
    }
    return E;
  }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.FBTAZKYW.js
var SlDetails = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.open = false;
    this.disabled = false;
  }
  firstUpdated() {
    this.body.style.height = this.open ? "auto" : "0";
    if (this.open) {
      this.details.open = true;
    }
    this.detailsObserver = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes" && change.attributeName === "open") {
          if (this.details.open) {
            this.show();
          } else {
            this.hide();
          }
        }
      }
    });
    this.detailsObserver.observe(this.details, { attributes: true });
  }
  disconnectedCallback() {
    var _a;
    super.disconnectedCallback();
    (_a = this.detailsObserver) == null ? void 0 : _a.disconnect();
  }
  handleSummaryClick(event) {
    event.preventDefault();
    if (!this.disabled) {
      if (this.open) {
        this.hide();
      } else {
        this.show();
      }
      this.header.focus();
    }
  }
  handleSummaryKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (this.open) {
        this.hide();
      } else {
        this.show();
      }
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      this.hide();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      this.show();
    }
  }
  async handleOpenChange() {
    if (this.open) {
      this.details.open = true;
      const slShow = this.emit("sl-show", { cancelable: true });
      if (slShow.defaultPrevented) {
        this.open = false;
        this.details.open = false;
        return;
      }
      await stopAnimations(this.body);
      const { keyframes, options } = getAnimation(this, "details.show", { dir: this.localize.dir() });
      await animateTo(this.body, shimKeyframesHeightAuto(keyframes, this.body.scrollHeight), options);
      this.body.style.height = "auto";
      this.emit("sl-after-show");
    } else {
      const slHide = this.emit("sl-hide", { cancelable: true });
      if (slHide.defaultPrevented) {
        this.details.open = true;
        this.open = true;
        return;
      }
      await stopAnimations(this.body);
      const { keyframes, options } = getAnimation(this, "details.hide", { dir: this.localize.dir() });
      await animateTo(this.body, shimKeyframesHeightAuto(keyframes, this.body.scrollHeight), options);
      this.body.style.height = "auto";
      this.details.open = false;
      this.emit("sl-after-hide");
    }
  }
  /** Shows the details. */
  async show() {
    if (this.open || this.disabled) {
      return void 0;
    }
    this.open = true;
    return waitForEvent(this, "sl-after-show");
  }
  /** Hides the details */
  async hide() {
    if (!this.open || this.disabled) {
      return void 0;
    }
    this.open = false;
    return waitForEvent(this, "sl-after-hide");
  }
  render() {
    const isRtl = this.localize.dir() === "rtl";
    return b`
      <details
        part="base"
        class=${e8({
      details: true,
      "details--open": this.open,
      "details--disabled": this.disabled,
      "details--rtl": isRtl
    })}
      >
        <summary
          part="header"
          id="header"
          class="details__header"
          role="button"
          aria-expanded=${this.open ? "true" : "false"}
          aria-controls="content"
          aria-disabled=${this.disabled ? "true" : "false"}
          tabindex=${this.disabled ? "-1" : "0"}
          @click=${this.handleSummaryClick}
          @keydown=${this.handleSummaryKeyDown}
        >
          <slot name="summary" part="summary" class="details__summary">${this.summary}</slot>

          <span part="summary-icon" class="details__summary-icon">
            <slot name="expand-icon">
              <sl-icon library="system" name=${isRtl ? "chevron-left" : "chevron-right"}></sl-icon>
            </slot>
            <slot name="collapse-icon">
              <sl-icon library="system" name=${isRtl ? "chevron-left" : "chevron-right"}></sl-icon>
            </slot>
          </span>
        </summary>

        <div class="details__body" role="region" aria-labelledby="header">
          <slot part="content" id="content" class="details__content"></slot>
        </div>
      </details>
    `;
  }
};
SlDetails.styles = [component_styles_default, details_styles_default];
SlDetails.dependencies = {
  "sl-icon": SlIcon
};
__decorateClass([
  e7(".details")
], SlDetails.prototype, "details", 2);
__decorateClass([
  e7(".details__header")
], SlDetails.prototype, "header", 2);
__decorateClass([
  e7(".details__body")
], SlDetails.prototype, "body", 2);
__decorateClass([
  e7(".details__expand-icon-slot")
], SlDetails.prototype, "expandIconSlot", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlDetails.prototype, "open", 2);
__decorateClass([
  n4()
], SlDetails.prototype, "summary", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlDetails.prototype, "disabled", 2);
__decorateClass([
  watch("open", { waitUntilFirstUpdate: true })
], SlDetails.prototype, "handleOpenChange", 1);
setDefaultAnimation("details.show", {
  keyframes: [
    { height: "0", opacity: "0" },
    { height: "auto", opacity: "1" }
  ],
  options: { duration: 250, easing: "linear" }
});
setDefaultAnimation("details.hide", {
  keyframes: [
    { height: "auto", opacity: "1" },
    { height: "0", opacity: "0" }
  ],
  options: { duration: 250, easing: "linear" }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.4MEHASAI.js
SlDetails.define("sl-details");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.V2OL7VMD.js
var tag_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.6I2T3DLI.js
var icon_button_styles_default = i3`
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
`;

// node_modules/lit-html/static.js
var a3 = /* @__PURE__ */ Symbol.for("");
var o8 = (t6) => {
  if (t6?.r === a3) return t6?._$litStatic$;
};
var i6 = (t6, ...r11) => ({ _$litStatic$: r11.reduce((r12, e10, a4) => r12 + ((t7) => {
  if (void 0 !== t7._$litStatic$) return t7._$litStatic$;
  throw Error(`Value passed to 'literal' function must be a 'literal' result: ${t7}. Use 'unsafeStatic' to pass non-literal values, but
            take care to ensure page security.`);
})(e10) + t6[a4 + 1], t6[0]), r: a3 });
var l4 = /* @__PURE__ */ new Map();
var n5 = (t6) => (r11, ...e10) => {
  const a4 = e10.length;
  let s4, i8;
  const n6 = [], u4 = [];
  let c5, $5 = 0, f3 = false;
  for (; $5 < a4; ) {
    for (c5 = r11[$5]; $5 < a4 && void 0 !== (i8 = e10[$5], s4 = o8(i8)); ) c5 += s4 + r11[++$5], f3 = true;
    $5 !== a4 && u4.push(i8), n6.push(c5), $5++;
  }
  if ($5 === a4 && n6.push(r11[a4]), f3) {
    const t7 = n6.join("$$lit$$");
    void 0 === (r11 = l4.get(t7)) && (n6.raw = n6, l4.set(t7, r11 = n6)), e10 = u4;
  }
  return t6(r11, ...e10);
};
var u3 = n5(b);
var c4 = n5(w);
var $4 = n5(T);

// node_modules/lit-html/directives/if-defined.js
var o9 = (o10) => o10 ?? A;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.7E4JTYWU.js
var SlIconButton = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.hasFocus = false;
    this.label = "";
    this.disabled = false;
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleFocus() {
    this.hasFocus = true;
    this.emit("sl-focus");
  }
  handleClick(event) {
    if (this.disabled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  /** Simulates a click on the icon button. */
  click() {
    this.button.click();
  }
  /** Sets focus on the icon button. */
  focus(options) {
    this.button.focus(options);
  }
  /** Removes focus from the icon button. */
  blur() {
    this.button.blur();
  }
  render() {
    const isLink = this.href ? true : false;
    const tag = isLink ? i6`a` : i6`button`;
    return u3`
      <${tag}
        part="base"
        class=${e8({
      "icon-button": true,
      "icon-button--disabled": !isLink && this.disabled,
      "icon-button--focused": this.hasFocus
    })}
        ?disabled=${o9(isLink ? void 0 : this.disabled)}
        type=${o9(isLink ? void 0 : "button")}
        href=${o9(isLink ? this.href : void 0)}
        target=${o9(isLink ? this.target : void 0)}
        download=${o9(isLink ? this.download : void 0)}
        rel=${o9(isLink && this.target ? "noreferrer noopener" : void 0)}
        role=${o9(isLink ? void 0 : "button")}
        aria-disabled=${this.disabled ? "true" : "false"}
        aria-label="${this.label}"
        tabindex=${this.disabled ? "-1" : "0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @click=${this.handleClick}
      >
        <sl-icon
          class="icon-button__icon"
          name=${o9(this.name)}
          library=${o9(this.library)}
          src=${o9(this.src)}
          aria-hidden="true"
        ></sl-icon>
      </${tag}>
    `;
  }
};
SlIconButton.styles = [component_styles_default, icon_button_styles_default];
SlIconButton.dependencies = { "sl-icon": SlIcon };
__decorateClass([
  e7(".icon-button")
], SlIconButton.prototype, "button", 2);
__decorateClass([
  r8()
], SlIconButton.prototype, "hasFocus", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "name", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "library", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "src", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "href", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "target", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "download", 2);
__decorateClass([
  n4()
], SlIconButton.prototype, "label", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlIconButton.prototype, "disabled", 2);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.6R4LM7O6.js
var SlTag = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.variant = "neutral";
    this.size = "medium";
    this.pill = false;
    this.removable = false;
  }
  handleRemoveClick() {
    this.emit("sl-remove");
  }
  render() {
    return b`
      <span
        part="base"
        class=${e8({
      tag: true,
      // Types
      "tag--primary": this.variant === "primary",
      "tag--success": this.variant === "success",
      "tag--neutral": this.variant === "neutral",
      "tag--warning": this.variant === "warning",
      "tag--danger": this.variant === "danger",
      "tag--text": this.variant === "text",
      // Sizes
      "tag--small": this.size === "small",
      "tag--medium": this.size === "medium",
      "tag--large": this.size === "large",
      // Modifiers
      "tag--pill": this.pill,
      "tag--removable": this.removable
    })}
      >
        <slot part="content" class="tag__content"></slot>

        ${this.removable ? b`
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
            ` : ""}
      </span>
    `;
  }
};
SlTag.styles = [component_styles_default, tag_styles_default];
SlTag.dependencies = { "sl-icon-button": SlIconButton };
__decorateClass([
  n4({ reflect: true })
], SlTag.prototype, "variant", 2);
__decorateClass([
  n4({ reflect: true })
], SlTag.prototype, "size", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTag.prototype, "pill", 2);
__decorateClass([
  n4({ type: Boolean })
], SlTag.prototype, "removable", 2);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.XNOUITPX.js
var select_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.RWUUFNUL.js
function getOffset(element, parent) {
  return {
    top: Math.round(element.getBoundingClientRect().top - parent.getBoundingClientRect().top),
    left: Math.round(element.getBoundingClientRect().left - parent.getBoundingClientRect().left)
  };
}
var locks = /* @__PURE__ */ new Set();
function getScrollbarWidth() {
  const documentWidth = document.documentElement.clientWidth;
  return Math.abs(window.innerWidth - documentWidth);
}
function getExistingBodyPadding() {
  const padding = Number(getComputedStyle(document.body).paddingRight.replace(/px/, ""));
  if (isNaN(padding) || !padding) {
    return 0;
  }
  return padding;
}
function lockBodyScrolling(lockingEl) {
  locks.add(lockingEl);
  if (!document.documentElement.classList.contains("sl-scroll-lock")) {
    const scrollbarWidth = getScrollbarWidth() + getExistingBodyPadding();
    let scrollbarGutterProperty = getComputedStyle(document.documentElement).scrollbarGutter;
    if (!scrollbarGutterProperty || scrollbarGutterProperty === "auto") {
      scrollbarGutterProperty = "stable";
    }
    if (scrollbarWidth < 2) {
      scrollbarGutterProperty = "";
    }
    document.documentElement.style.setProperty("--sl-scroll-lock-gutter", scrollbarGutterProperty);
    document.documentElement.classList.add("sl-scroll-lock");
    document.documentElement.style.setProperty("--sl-scroll-lock-size", `${scrollbarWidth}px`);
  }
}
function unlockBodyScrolling(lockingEl) {
  locks.delete(lockingEl);
  if (locks.size === 0) {
    document.documentElement.classList.remove("sl-scroll-lock");
    document.documentElement.style.removeProperty("--sl-scroll-lock-size");
  }
}
function scrollIntoView(element, container, direction = "vertical", behavior = "smooth") {
  const offset3 = getOffset(element, container);
  const offsetTop = offset3.top + container.scrollTop;
  const offsetLeft = offset3.left + container.scrollLeft;
  const minX = container.scrollLeft;
  const maxX = container.scrollLeft + container.offsetWidth;
  const minY = container.scrollTop;
  const maxY = container.scrollTop + container.offsetHeight;
  if (direction === "horizontal" || direction === "both") {
    if (offsetLeft < minX) {
      container.scrollTo({ left: offsetLeft, behavior });
    } else if (offsetLeft + element.clientWidth > maxX) {
      container.scrollTo({ left: offsetLeft - container.offsetWidth + element.clientWidth, behavior });
    }
  }
  if (direction === "vertical" || direction === "both") {
    if (offsetTop < minY) {
      container.scrollTo({ top: offsetTop, behavior });
    } else if (offsetTop + element.clientHeight > maxY) {
      container.scrollTo({ top: offsetTop - container.offsetHeight + element.clientHeight, behavior });
    }
  }
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.SI4ACBFK.js
var form_control_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3KSWVBQ5.js
var popup_styles_default = i3`
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
`;

// node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
var min = Math.min;
var max = Math.max;
var round = Math.round;
var floor = Math.floor;
var createCoords = (v2) => ({
  x: v2,
  y: v2
});
var oppositeSideMap = {
  left: "right",
  right: "left",
  bottom: "top",
  top: "bottom"
};
function clamp(start, value, end) {
  return max(start, min(value, end));
}
function evaluate(value, param) {
  return typeof value === "function" ? value(param) : value;
}
function getSide(placement) {
  return placement.split("-")[0];
}
function getAlignment(placement) {
  return placement.split("-")[1];
}
function getOppositeAxis(axis) {
  return axis === "x" ? "y" : "x";
}
function getAxisLength(axis) {
  return axis === "y" ? "height" : "width";
}
function getSideAxis(placement) {
  const firstChar = placement[0];
  return firstChar === "t" || firstChar === "b" ? "y" : "x";
}
function getAlignmentAxis(placement) {
  return getOppositeAxis(getSideAxis(placement));
}
function getAlignmentSides(placement, rects, rtl) {
  if (rtl === void 0) {
    rtl = false;
  }
  const alignment = getAlignment(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const length = getAxisLength(alignmentAxis);
  let mainAlignmentSide = alignmentAxis === "x" ? alignment === (rtl ? "end" : "start") ? "right" : "left" : alignment === "start" ? "bottom" : "top";
  if (rects.reference[length] > rects.floating[length]) {
    mainAlignmentSide = getOppositePlacement(mainAlignmentSide);
  }
  return [mainAlignmentSide, getOppositePlacement(mainAlignmentSide)];
}
function getExpandedPlacements(placement) {
  const oppositePlacement = getOppositePlacement(placement);
  return [getOppositeAlignmentPlacement(placement), oppositePlacement, getOppositeAlignmentPlacement(oppositePlacement)];
}
function getOppositeAlignmentPlacement(placement) {
  return placement.includes("start") ? placement.replace("start", "end") : placement.replace("end", "start");
}
var lrPlacement = ["left", "right"];
var rlPlacement = ["right", "left"];
var tbPlacement = ["top", "bottom"];
var btPlacement = ["bottom", "top"];
function getSideList(side, isStart, rtl) {
  switch (side) {
    case "top":
    case "bottom":
      if (rtl) return isStart ? rlPlacement : lrPlacement;
      return isStart ? lrPlacement : rlPlacement;
    case "left":
    case "right":
      return isStart ? tbPlacement : btPlacement;
    default:
      return [];
  }
}
function getOppositeAxisPlacements(placement, flipAlignment, direction, rtl) {
  const alignment = getAlignment(placement);
  let list = getSideList(getSide(placement), direction === "start", rtl);
  if (alignment) {
    list = list.map((side) => side + "-" + alignment);
    if (flipAlignment) {
      list = list.concat(list.map(getOppositeAlignmentPlacement));
    }
  }
  return list;
}
function getOppositePlacement(placement) {
  const side = getSide(placement);
  return oppositeSideMap[side] + placement.slice(side.length);
}
function expandPaddingObject(padding) {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    ...padding
  };
}
function getPaddingObject(padding) {
  return typeof padding !== "number" ? expandPaddingObject(padding) : {
    top: padding,
    right: padding,
    bottom: padding,
    left: padding
  };
}
function rectToClientRect(rect) {
  const {
    x: x2,
    y: y3,
    width,
    height
  } = rect;
  return {
    width,
    height,
    top: y3,
    left: x2,
    right: x2 + width,
    bottom: y3 + height,
    x: x2,
    y: y3
  };
}

// node_modules/@floating-ui/core/dist/floating-ui.core.mjs
function computeCoordsFromPlacement(_ref, placement, rtl) {
  let {
    reference,
    floating
  } = _ref;
  const sideAxis = getSideAxis(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const alignLength = getAxisLength(alignmentAxis);
  const side = getSide(placement);
  const isVertical = sideAxis === "y";
  const commonX = reference.x + reference.width / 2 - floating.width / 2;
  const commonY = reference.y + reference.height / 2 - floating.height / 2;
  const commonAlign = reference[alignLength] / 2 - floating[alignLength] / 2;
  let coords;
  switch (side) {
    case "top":
      coords = {
        x: commonX,
        y: reference.y - floating.height
      };
      break;
    case "bottom":
      coords = {
        x: commonX,
        y: reference.y + reference.height
      };
      break;
    case "right":
      coords = {
        x: reference.x + reference.width,
        y: commonY
      };
      break;
    case "left":
      coords = {
        x: reference.x - floating.width,
        y: commonY
      };
      break;
    default:
      coords = {
        x: reference.x,
        y: reference.y
      };
  }
  switch (getAlignment(placement)) {
    case "start":
      coords[alignmentAxis] -= commonAlign * (rtl && isVertical ? -1 : 1);
      break;
    case "end":
      coords[alignmentAxis] += commonAlign * (rtl && isVertical ? -1 : 1);
      break;
  }
  return coords;
}
async function detectOverflow(state, options) {
  var _await$platform$isEle;
  if (options === void 0) {
    options = {};
  }
  const {
    x: x2,
    y: y3,
    platform: platform2,
    rects,
    elements,
    strategy
  } = state;
  const {
    boundary = "clippingAncestors",
    rootBoundary = "viewport",
    elementContext = "floating",
    altBoundary = false,
    padding = 0
  } = evaluate(options, state);
  const paddingObject = getPaddingObject(padding);
  const altContext = elementContext === "floating" ? "reference" : "floating";
  const element = elements[altBoundary ? altContext : elementContext];
  const clippingClientRect = rectToClientRect(await platform2.getClippingRect({
    element: ((_await$platform$isEle = await (platform2.isElement == null ? void 0 : platform2.isElement(element))) != null ? _await$platform$isEle : true) ? element : element.contextElement || await (platform2.getDocumentElement == null ? void 0 : platform2.getDocumentElement(elements.floating)),
    boundary,
    rootBoundary,
    strategy
  }));
  const rect = elementContext === "floating" ? {
    x: x2,
    y: y3,
    width: rects.floating.width,
    height: rects.floating.height
  } : rects.reference;
  const offsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(elements.floating));
  const offsetScale = await (platform2.isElement == null ? void 0 : platform2.isElement(offsetParent)) ? await (platform2.getScale == null ? void 0 : platform2.getScale(offsetParent)) || {
    x: 1,
    y: 1
  } : {
    x: 1,
    y: 1
  };
  const elementClientRect = rectToClientRect(platform2.convertOffsetParentRelativeRectToViewportRelativeRect ? await platform2.convertOffsetParentRelativeRectToViewportRelativeRect({
    elements,
    rect,
    offsetParent,
    strategy
  }) : rect);
  return {
    top: (clippingClientRect.top - elementClientRect.top + paddingObject.top) / offsetScale.y,
    bottom: (elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom) / offsetScale.y,
    left: (clippingClientRect.left - elementClientRect.left + paddingObject.left) / offsetScale.x,
    right: (elementClientRect.right - clippingClientRect.right + paddingObject.right) / offsetScale.x
  };
}
var MAX_RESET_COUNT = 50;
var computePosition = async (reference, floating, config) => {
  const {
    placement = "bottom",
    strategy = "absolute",
    middleware = [],
    platform: platform2
  } = config;
  const platformWithDetectOverflow = platform2.detectOverflow ? platform2 : {
    ...platform2,
    detectOverflow
  };
  const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(floating));
  let rects = await platform2.getElementRects({
    reference,
    floating,
    strategy
  });
  let {
    x: x2,
    y: y3
  } = computeCoordsFromPlacement(rects, placement, rtl);
  let statefulPlacement = placement;
  let resetCount = 0;
  const middlewareData = {};
  for (let i8 = 0; i8 < middleware.length; i8++) {
    const currentMiddleware = middleware[i8];
    if (!currentMiddleware) {
      continue;
    }
    const {
      name,
      fn
    } = currentMiddleware;
    const {
      x: nextX,
      y: nextY,
      data,
      reset
    } = await fn({
      x: x2,
      y: y3,
      initialPlacement: placement,
      placement: statefulPlacement,
      strategy,
      middlewareData,
      rects,
      platform: platformWithDetectOverflow,
      elements: {
        reference,
        floating
      }
    });
    x2 = nextX != null ? nextX : x2;
    y3 = nextY != null ? nextY : y3;
    middlewareData[name] = {
      ...middlewareData[name],
      ...data
    };
    if (reset && resetCount < MAX_RESET_COUNT) {
      resetCount++;
      if (typeof reset === "object") {
        if (reset.placement) {
          statefulPlacement = reset.placement;
        }
        if (reset.rects) {
          rects = reset.rects === true ? await platform2.getElementRects({
            reference,
            floating,
            strategy
          }) : reset.rects;
        }
        ({
          x: x2,
          y: y3
        } = computeCoordsFromPlacement(rects, statefulPlacement, rtl));
      }
      i8 = -1;
    }
  }
  return {
    x: x2,
    y: y3,
    placement: statefulPlacement,
    strategy,
    middlewareData
  };
};
var arrow = (options) => ({
  name: "arrow",
  options,
  async fn(state) {
    const {
      x: x2,
      y: y3,
      placement,
      rects,
      platform: platform2,
      elements,
      middlewareData
    } = state;
    const {
      element,
      padding = 0
    } = evaluate(options, state) || {};
    if (element == null) {
      return {};
    }
    const paddingObject = getPaddingObject(padding);
    const coords = {
      x: x2,
      y: y3
    };
    const axis = getAlignmentAxis(placement);
    const length = getAxisLength(axis);
    const arrowDimensions = await platform2.getDimensions(element);
    const isYAxis = axis === "y";
    const minProp = isYAxis ? "top" : "left";
    const maxProp = isYAxis ? "bottom" : "right";
    const clientProp = isYAxis ? "clientHeight" : "clientWidth";
    const endDiff = rects.reference[length] + rects.reference[axis] - coords[axis] - rects.floating[length];
    const startDiff = coords[axis] - rects.reference[axis];
    const arrowOffsetParent = await (platform2.getOffsetParent == null ? void 0 : platform2.getOffsetParent(element));
    let clientSize = arrowOffsetParent ? arrowOffsetParent[clientProp] : 0;
    if (!clientSize || !await (platform2.isElement == null ? void 0 : platform2.isElement(arrowOffsetParent))) {
      clientSize = elements.floating[clientProp] || rects.floating[length];
    }
    const centerToReference = endDiff / 2 - startDiff / 2;
    const largestPossiblePadding = clientSize / 2 - arrowDimensions[length] / 2 - 1;
    const minPadding = min(paddingObject[minProp], largestPossiblePadding);
    const maxPadding = min(paddingObject[maxProp], largestPossiblePadding);
    const min$1 = minPadding;
    const max2 = clientSize - arrowDimensions[length] - maxPadding;
    const center = clientSize / 2 - arrowDimensions[length] / 2 + centerToReference;
    const offset3 = clamp(min$1, center, max2);
    const shouldAddOffset = !middlewareData.arrow && getAlignment(placement) != null && center !== offset3 && rects.reference[length] / 2 - (center < min$1 ? minPadding : maxPadding) - arrowDimensions[length] / 2 < 0;
    const alignmentOffset = shouldAddOffset ? center < min$1 ? center - min$1 : center - max2 : 0;
    return {
      [axis]: coords[axis] + alignmentOffset,
      data: {
        [axis]: offset3,
        centerOffset: center - offset3 - alignmentOffset,
        ...shouldAddOffset && {
          alignmentOffset
        }
      },
      reset: shouldAddOffset
    };
  }
});
var flip = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "flip",
    options,
    async fn(state) {
      var _middlewareData$arrow, _middlewareData$flip;
      const {
        placement,
        middlewareData,
        rects,
        initialPlacement,
        platform: platform2,
        elements
      } = state;
      const {
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = true,
        fallbackPlacements: specifiedFallbackPlacements,
        fallbackStrategy = "bestFit",
        fallbackAxisSideDirection = "none",
        flipAlignment = true,
        ...detectOverflowOptions
      } = evaluate(options, state);
      if ((_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
        return {};
      }
      const side = getSide(placement);
      const initialSideAxis = getSideAxis(initialPlacement);
      const isBasePlacement = getSide(initialPlacement) === initialPlacement;
      const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
      const fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipAlignment ? [getOppositePlacement(initialPlacement)] : getExpandedPlacements(initialPlacement));
      const hasFallbackAxisSideDirection = fallbackAxisSideDirection !== "none";
      if (!specifiedFallbackPlacements && hasFallbackAxisSideDirection) {
        fallbackPlacements.push(...getOppositeAxisPlacements(initialPlacement, flipAlignment, fallbackAxisSideDirection, rtl));
      }
      const placements2 = [initialPlacement, ...fallbackPlacements];
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const overflows = [];
      let overflowsData = ((_middlewareData$flip = middlewareData.flip) == null ? void 0 : _middlewareData$flip.overflows) || [];
      if (checkMainAxis) {
        overflows.push(overflow[side]);
      }
      if (checkCrossAxis) {
        const sides2 = getAlignmentSides(placement, rects, rtl);
        overflows.push(overflow[sides2[0]], overflow[sides2[1]]);
      }
      overflowsData = [...overflowsData, {
        placement,
        overflows
      }];
      if (!overflows.every((side2) => side2 <= 0)) {
        var _middlewareData$flip2, _overflowsData$filter;
        const nextIndex = (((_middlewareData$flip2 = middlewareData.flip) == null ? void 0 : _middlewareData$flip2.index) || 0) + 1;
        const nextPlacement = placements2[nextIndex];
        if (nextPlacement) {
          const ignoreCrossAxisOverflow = checkCrossAxis === "alignment" ? initialSideAxis !== getSideAxis(nextPlacement) : false;
          if (!ignoreCrossAxisOverflow || // We leave the current main axis only if every placement on that axis
          // overflows the main axis.
          overflowsData.every((d3) => getSideAxis(d3.placement) === initialSideAxis ? d3.overflows[0] > 0 : true)) {
            return {
              data: {
                index: nextIndex,
                overflows: overflowsData
              },
              reset: {
                placement: nextPlacement
              }
            };
          }
        }
        let resetPlacement = (_overflowsData$filter = overflowsData.filter((d3) => d3.overflows[0] <= 0).sort((a4, b3) => a4.overflows[1] - b3.overflows[1])[0]) == null ? void 0 : _overflowsData$filter.placement;
        if (!resetPlacement) {
          switch (fallbackStrategy) {
            case "bestFit": {
              var _overflowsData$filter2;
              const placement2 = (_overflowsData$filter2 = overflowsData.filter((d3) => {
                if (hasFallbackAxisSideDirection) {
                  const currentSideAxis = getSideAxis(d3.placement);
                  return currentSideAxis === initialSideAxis || // Create a bias to the `y` side axis due to horizontal
                  // reading directions favoring greater width.
                  currentSideAxis === "y";
                }
                return true;
              }).map((d3) => [d3.placement, d3.overflows.filter((overflow2) => overflow2 > 0).reduce((acc, overflow2) => acc + overflow2, 0)]).sort((a4, b3) => a4[1] - b3[1])[0]) == null ? void 0 : _overflowsData$filter2[0];
              if (placement2) {
                resetPlacement = placement2;
              }
              break;
            }
            case "initialPlacement":
              resetPlacement = initialPlacement;
              break;
          }
        }
        if (placement !== resetPlacement) {
          return {
            reset: {
              placement: resetPlacement
            }
          };
        }
      }
      return {};
    }
  };
};
var originSides = /* @__PURE__ */ new Set(["left", "top"]);
async function convertValueToCoords(state, options) {
  const {
    placement,
    platform: platform2,
    elements
  } = state;
  const rtl = await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating));
  const side = getSide(placement);
  const alignment = getAlignment(placement);
  const isVertical = getSideAxis(placement) === "y";
  const mainAxisMulti = originSides.has(side) ? -1 : 1;
  const crossAxisMulti = rtl && isVertical ? -1 : 1;
  const rawValue = evaluate(options, state);
  let {
    mainAxis,
    crossAxis,
    alignmentAxis
  } = typeof rawValue === "number" ? {
    mainAxis: rawValue,
    crossAxis: 0,
    alignmentAxis: null
  } : {
    mainAxis: rawValue.mainAxis || 0,
    crossAxis: rawValue.crossAxis || 0,
    alignmentAxis: rawValue.alignmentAxis
  };
  if (alignment && typeof alignmentAxis === "number") {
    crossAxis = alignment === "end" ? alignmentAxis * -1 : alignmentAxis;
  }
  return isVertical ? {
    x: crossAxis * crossAxisMulti,
    y: mainAxis * mainAxisMulti
  } : {
    x: mainAxis * mainAxisMulti,
    y: crossAxis * crossAxisMulti
  };
}
var offset = function(options) {
  if (options === void 0) {
    options = 0;
  }
  return {
    name: "offset",
    options,
    async fn(state) {
      var _middlewareData$offse, _middlewareData$arrow;
      const {
        x: x2,
        y: y3,
        placement,
        middlewareData
      } = state;
      const diffCoords = await convertValueToCoords(state, options);
      if (placement === ((_middlewareData$offse = middlewareData.offset) == null ? void 0 : _middlewareData$offse.placement) && (_middlewareData$arrow = middlewareData.arrow) != null && _middlewareData$arrow.alignmentOffset) {
        return {};
      }
      return {
        x: x2 + diffCoords.x,
        y: y3 + diffCoords.y,
        data: {
          ...diffCoords,
          placement
        }
      };
    }
  };
};
var shift = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "shift",
    options,
    async fn(state) {
      const {
        x: x2,
        y: y3,
        placement,
        platform: platform2
      } = state;
      const {
        mainAxis: checkMainAxis = true,
        crossAxis: checkCrossAxis = false,
        limiter = {
          fn: (_ref) => {
            let {
              x: x3,
              y: y4
            } = _ref;
            return {
              x: x3,
              y: y4
            };
          }
        },
        ...detectOverflowOptions
      } = evaluate(options, state);
      const coords = {
        x: x2,
        y: y3
      };
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const crossAxis = getSideAxis(getSide(placement));
      const mainAxis = getOppositeAxis(crossAxis);
      let mainAxisCoord = coords[mainAxis];
      let crossAxisCoord = coords[crossAxis];
      if (checkMainAxis) {
        const minSide = mainAxis === "y" ? "top" : "left";
        const maxSide = mainAxis === "y" ? "bottom" : "right";
        const min2 = mainAxisCoord + overflow[minSide];
        const max2 = mainAxisCoord - overflow[maxSide];
        mainAxisCoord = clamp(min2, mainAxisCoord, max2);
      }
      if (checkCrossAxis) {
        const minSide = crossAxis === "y" ? "top" : "left";
        const maxSide = crossAxis === "y" ? "bottom" : "right";
        const min2 = crossAxisCoord + overflow[minSide];
        const max2 = crossAxisCoord - overflow[maxSide];
        crossAxisCoord = clamp(min2, crossAxisCoord, max2);
      }
      const limitedCoords = limiter.fn({
        ...state,
        [mainAxis]: mainAxisCoord,
        [crossAxis]: crossAxisCoord
      });
      return {
        ...limitedCoords,
        data: {
          x: limitedCoords.x - x2,
          y: limitedCoords.y - y3,
          enabled: {
            [mainAxis]: checkMainAxis,
            [crossAxis]: checkCrossAxis
          }
        }
      };
    }
  };
};
var size = function(options) {
  if (options === void 0) {
    options = {};
  }
  return {
    name: "size",
    options,
    async fn(state) {
      var _state$middlewareData, _state$middlewareData2;
      const {
        placement,
        rects,
        platform: platform2,
        elements
      } = state;
      const {
        apply = () => {
        },
        ...detectOverflowOptions
      } = evaluate(options, state);
      const overflow = await platform2.detectOverflow(state, detectOverflowOptions);
      const side = getSide(placement);
      const alignment = getAlignment(placement);
      const isYAxis = getSideAxis(placement) === "y";
      const {
        width,
        height
      } = rects.floating;
      let heightSide;
      let widthSide;
      if (side === "top" || side === "bottom") {
        heightSide = side;
        widthSide = alignment === (await (platform2.isRTL == null ? void 0 : platform2.isRTL(elements.floating)) ? "start" : "end") ? "left" : "right";
      } else {
        widthSide = side;
        heightSide = alignment === "end" ? "top" : "bottom";
      }
      const maximumClippingHeight = height - overflow.top - overflow.bottom;
      const maximumClippingWidth = width - overflow.left - overflow.right;
      const overflowAvailableHeight = min(height - overflow[heightSide], maximumClippingHeight);
      const overflowAvailableWidth = min(width - overflow[widthSide], maximumClippingWidth);
      const noShift = !state.middlewareData.shift;
      let availableHeight = overflowAvailableHeight;
      let availableWidth = overflowAvailableWidth;
      if ((_state$middlewareData = state.middlewareData.shift) != null && _state$middlewareData.enabled.x) {
        availableWidth = maximumClippingWidth;
      }
      if ((_state$middlewareData2 = state.middlewareData.shift) != null && _state$middlewareData2.enabled.y) {
        availableHeight = maximumClippingHeight;
      }
      if (noShift && !alignment) {
        const xMin = max(overflow.left, 0);
        const xMax = max(overflow.right, 0);
        const yMin = max(overflow.top, 0);
        const yMax = max(overflow.bottom, 0);
        if (isYAxis) {
          availableWidth = width - 2 * (xMin !== 0 || xMax !== 0 ? xMin + xMax : max(overflow.left, overflow.right));
        } else {
          availableHeight = height - 2 * (yMin !== 0 || yMax !== 0 ? yMin + yMax : max(overflow.top, overflow.bottom));
        }
      }
      await apply({
        ...state,
        availableWidth,
        availableHeight
      });
      const nextDimensions = await platform2.getDimensions(elements.floating);
      if (width !== nextDimensions.width || height !== nextDimensions.height) {
        return {
          reset: {
            rects: true
          }
        };
      }
      return {};
    }
  };
};

// node_modules/@floating-ui/utils/dist/floating-ui.utils.dom.mjs
function hasWindow() {
  return typeof window !== "undefined";
}
function getNodeName(node) {
  if (isNode(node)) {
    return (node.nodeName || "").toLowerCase();
  }
  return "#document";
}
function getWindow(node) {
  var _node$ownerDocument;
  return (node == null || (_node$ownerDocument = node.ownerDocument) == null ? void 0 : _node$ownerDocument.defaultView) || window;
}
function getDocumentElement(node) {
  var _ref;
  return (_ref = (isNode(node) ? node.ownerDocument : node.document) || window.document) == null ? void 0 : _ref.documentElement;
}
function isNode(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof Node || value instanceof getWindow(value).Node;
}
function isElement(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof Element || value instanceof getWindow(value).Element;
}
function isHTMLElement(value) {
  if (!hasWindow()) {
    return false;
  }
  return value instanceof HTMLElement || value instanceof getWindow(value).HTMLElement;
}
function isShadowRoot(value) {
  if (!hasWindow() || typeof ShadowRoot === "undefined") {
    return false;
  }
  return value instanceof ShadowRoot || value instanceof getWindow(value).ShadowRoot;
}
function isOverflowElement(element) {
  const {
    overflow,
    overflowX,
    overflowY,
    display
  } = getComputedStyle2(element);
  return /auto|scroll|overlay|hidden|clip/.test(overflow + overflowY + overflowX) && display !== "inline" && display !== "contents";
}
function isTableElement(element) {
  return /^(table|td|th)$/.test(getNodeName(element));
}
function isTopLayer(element) {
  try {
    if (element.matches(":popover-open")) {
      return true;
    }
  } catch (_e2) {
  }
  try {
    return element.matches(":modal");
  } catch (_e2) {
    return false;
  }
}
var willChangeRe = /transform|translate|scale|rotate|perspective|filter/;
var containRe = /paint|layout|strict|content/;
var isNotNone = (value) => !!value && value !== "none";
var isWebKitValue;
function isContainingBlock(elementOrCss) {
  const css = isElement(elementOrCss) ? getComputedStyle2(elementOrCss) : elementOrCss;
  return isNotNone(css.transform) || isNotNone(css.translate) || isNotNone(css.scale) || isNotNone(css.rotate) || isNotNone(css.perspective) || !isWebKit() && (isNotNone(css.backdropFilter) || isNotNone(css.filter)) || willChangeRe.test(css.willChange || "") || containRe.test(css.contain || "");
}
function getContainingBlock(element) {
  let currentNode = getParentNode(element);
  while (isHTMLElement(currentNode) && !isLastTraversableNode(currentNode)) {
    if (isContainingBlock(currentNode)) {
      return currentNode;
    } else if (isTopLayer(currentNode)) {
      return null;
    }
    currentNode = getParentNode(currentNode);
  }
  return null;
}
function isWebKit() {
  if (isWebKitValue == null) {
    isWebKitValue = typeof CSS !== "undefined" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none");
  }
  return isWebKitValue;
}
function isLastTraversableNode(node) {
  return /^(html|body|#document)$/.test(getNodeName(node));
}
function getComputedStyle2(element) {
  return getWindow(element).getComputedStyle(element);
}
function getNodeScroll(element) {
  if (isElement(element)) {
    return {
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop
    };
  }
  return {
    scrollLeft: element.scrollX,
    scrollTop: element.scrollY
  };
}
function getParentNode(node) {
  if (getNodeName(node) === "html") {
    return node;
  }
  const result = (
    // Step into the shadow DOM of the parent of a slotted node.
    node.assignedSlot || // DOM Element detected.
    node.parentNode || // ShadowRoot detected.
    isShadowRoot(node) && node.host || // Fallback.
    getDocumentElement(node)
  );
  return isShadowRoot(result) ? result.host : result;
}
function getNearestOverflowAncestor(node) {
  const parentNode = getParentNode(node);
  if (isLastTraversableNode(parentNode)) {
    return node.ownerDocument ? node.ownerDocument.body : node.body;
  }
  if (isHTMLElement(parentNode) && isOverflowElement(parentNode)) {
    return parentNode;
  }
  return getNearestOverflowAncestor(parentNode);
}
function getOverflowAncestors(node, list, traverseIframes) {
  var _node$ownerDocument2;
  if (list === void 0) {
    list = [];
  }
  if (traverseIframes === void 0) {
    traverseIframes = true;
  }
  const scrollableAncestor = getNearestOverflowAncestor(node);
  const isBody = scrollableAncestor === ((_node$ownerDocument2 = node.ownerDocument) == null ? void 0 : _node$ownerDocument2.body);
  const win = getWindow(scrollableAncestor);
  if (isBody) {
    const frameElement = getFrameElement(win);
    return list.concat(win, win.visualViewport || [], isOverflowElement(scrollableAncestor) ? scrollableAncestor : [], frameElement && traverseIframes ? getOverflowAncestors(frameElement) : []);
  } else {
    return list.concat(scrollableAncestor, getOverflowAncestors(scrollableAncestor, [], traverseIframes));
  }
}
function getFrameElement(win) {
  return win.parent && Object.getPrototypeOf(win.parent) ? win.frameElement : null;
}

// node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function getCssDimensions(element) {
  const css = getComputedStyle2(element);
  let width = parseFloat(css.width) || 0;
  let height = parseFloat(css.height) || 0;
  const hasOffset = isHTMLElement(element);
  const offsetWidth = hasOffset ? element.offsetWidth : width;
  const offsetHeight = hasOffset ? element.offsetHeight : height;
  const shouldFallback = round(width) !== offsetWidth || round(height) !== offsetHeight;
  if (shouldFallback) {
    width = offsetWidth;
    height = offsetHeight;
  }
  return {
    width,
    height,
    $: shouldFallback
  };
}
function unwrapElement(element) {
  return !isElement(element) ? element.contextElement : element;
}
function getScale(element) {
  const domElement = unwrapElement(element);
  if (!isHTMLElement(domElement)) {
    return createCoords(1);
  }
  const rect = domElement.getBoundingClientRect();
  const {
    width,
    height,
    $: $5
  } = getCssDimensions(domElement);
  let x2 = ($5 ? round(rect.width) : rect.width) / width;
  let y3 = ($5 ? round(rect.height) : rect.height) / height;
  if (!x2 || !Number.isFinite(x2)) {
    x2 = 1;
  }
  if (!y3 || !Number.isFinite(y3)) {
    y3 = 1;
  }
  return {
    x: x2,
    y: y3
  };
}
var noOffsets = /* @__PURE__ */ createCoords(0);
function getVisualOffsets(element) {
  const win = getWindow(element);
  if (!isWebKit() || !win.visualViewport) {
    return noOffsets;
  }
  return {
    x: win.visualViewport.offsetLeft,
    y: win.visualViewport.offsetTop
  };
}
function shouldAddVisualOffsets(element, isFixed, floatingOffsetParent) {
  if (isFixed === void 0) {
    isFixed = false;
  }
  if (!floatingOffsetParent || isFixed && floatingOffsetParent !== getWindow(element)) {
    return false;
  }
  return isFixed;
}
function getBoundingClientRect(element, includeScale, isFixedStrategy, offsetParent) {
  if (includeScale === void 0) {
    includeScale = false;
  }
  if (isFixedStrategy === void 0) {
    isFixedStrategy = false;
  }
  const clientRect = element.getBoundingClientRect();
  const domElement = unwrapElement(element);
  let scale = createCoords(1);
  if (includeScale) {
    if (offsetParent) {
      if (isElement(offsetParent)) {
        scale = getScale(offsetParent);
      }
    } else {
      scale = getScale(element);
    }
  }
  const visualOffsets = shouldAddVisualOffsets(domElement, isFixedStrategy, offsetParent) ? getVisualOffsets(domElement) : createCoords(0);
  let x2 = (clientRect.left + visualOffsets.x) / scale.x;
  let y3 = (clientRect.top + visualOffsets.y) / scale.y;
  let width = clientRect.width / scale.x;
  let height = clientRect.height / scale.y;
  if (domElement) {
    const win = getWindow(domElement);
    const offsetWin = offsetParent && isElement(offsetParent) ? getWindow(offsetParent) : offsetParent;
    let currentWin = win;
    let currentIFrame = getFrameElement(currentWin);
    while (currentIFrame && offsetParent && offsetWin !== currentWin) {
      const iframeScale = getScale(currentIFrame);
      const iframeRect = currentIFrame.getBoundingClientRect();
      const css = getComputedStyle2(currentIFrame);
      const left = iframeRect.left + (currentIFrame.clientLeft + parseFloat(css.paddingLeft)) * iframeScale.x;
      const top = iframeRect.top + (currentIFrame.clientTop + parseFloat(css.paddingTop)) * iframeScale.y;
      x2 *= iframeScale.x;
      y3 *= iframeScale.y;
      width *= iframeScale.x;
      height *= iframeScale.y;
      x2 += left;
      y3 += top;
      currentWin = getWindow(currentIFrame);
      currentIFrame = getFrameElement(currentWin);
    }
  }
  return rectToClientRect({
    width,
    height,
    x: x2,
    y: y3
  });
}
function getWindowScrollBarX(element, rect) {
  const leftScroll = getNodeScroll(element).scrollLeft;
  if (!rect) {
    return getBoundingClientRect(getDocumentElement(element)).left + leftScroll;
  }
  return rect.left + leftScroll;
}
function getHTMLOffset(documentElement, scroll) {
  const htmlRect = documentElement.getBoundingClientRect();
  const x2 = htmlRect.left + scroll.scrollLeft - getWindowScrollBarX(documentElement, htmlRect);
  const y3 = htmlRect.top + scroll.scrollTop;
  return {
    x: x2,
    y: y3
  };
}
function convertOffsetParentRelativeRectToViewportRelativeRect(_ref) {
  let {
    elements,
    rect,
    offsetParent,
    strategy
  } = _ref;
  const isFixed = strategy === "fixed";
  const documentElement = getDocumentElement(offsetParent);
  const topLayer = elements ? isTopLayer(elements.floating) : false;
  if (offsetParent === documentElement || topLayer && isFixed) {
    return rect;
  }
  let scroll = {
    scrollLeft: 0,
    scrollTop: 0
  };
  let scale = createCoords(1);
  const offsets = createCoords(0);
  const isOffsetParentAnElement = isHTMLElement(offsetParent);
  if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
    if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) {
      scroll = getNodeScroll(offsetParent);
    }
    if (isOffsetParentAnElement) {
      const offsetRect = getBoundingClientRect(offsetParent);
      scale = getScale(offsetParent);
      offsets.x = offsetRect.x + offsetParent.clientLeft;
      offsets.y = offsetRect.y + offsetParent.clientTop;
    }
  }
  const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
  return {
    width: rect.width * scale.x,
    height: rect.height * scale.y,
    x: rect.x * scale.x - scroll.scrollLeft * scale.x + offsets.x + htmlOffset.x,
    y: rect.y * scale.y - scroll.scrollTop * scale.y + offsets.y + htmlOffset.y
  };
}
function getClientRects(element) {
  return Array.from(element.getClientRects());
}
function getDocumentRect(element) {
  const html = getDocumentElement(element);
  const scroll = getNodeScroll(element);
  const body = element.ownerDocument.body;
  const width = max(html.scrollWidth, html.clientWidth, body.scrollWidth, body.clientWidth);
  const height = max(html.scrollHeight, html.clientHeight, body.scrollHeight, body.clientHeight);
  let x2 = -scroll.scrollLeft + getWindowScrollBarX(element);
  const y3 = -scroll.scrollTop;
  if (getComputedStyle2(body).direction === "rtl") {
    x2 += max(html.clientWidth, body.clientWidth) - width;
  }
  return {
    width,
    height,
    x: x2,
    y: y3
  };
}
var SCROLLBAR_MAX = 25;
function getViewportRect(element, strategy) {
  const win = getWindow(element);
  const html = getDocumentElement(element);
  const visualViewport = win.visualViewport;
  let width = html.clientWidth;
  let height = html.clientHeight;
  let x2 = 0;
  let y3 = 0;
  if (visualViewport) {
    width = visualViewport.width;
    height = visualViewport.height;
    const visualViewportBased = isWebKit();
    if (!visualViewportBased || visualViewportBased && strategy === "fixed") {
      x2 = visualViewport.offsetLeft;
      y3 = visualViewport.offsetTop;
    }
  }
  const windowScrollbarX = getWindowScrollBarX(html);
  if (windowScrollbarX <= 0) {
    const doc = html.ownerDocument;
    const body = doc.body;
    const bodyStyles = getComputedStyle(body);
    const bodyMarginInline = doc.compatMode === "CSS1Compat" ? parseFloat(bodyStyles.marginLeft) + parseFloat(bodyStyles.marginRight) || 0 : 0;
    const clippingStableScrollbarWidth = Math.abs(html.clientWidth - body.clientWidth - bodyMarginInline);
    if (clippingStableScrollbarWidth <= SCROLLBAR_MAX) {
      width -= clippingStableScrollbarWidth;
    }
  } else if (windowScrollbarX <= SCROLLBAR_MAX) {
    width += windowScrollbarX;
  }
  return {
    width,
    height,
    x: x2,
    y: y3
  };
}
function getInnerBoundingClientRect(element, strategy) {
  const clientRect = getBoundingClientRect(element, true, strategy === "fixed");
  const top = clientRect.top + element.clientTop;
  const left = clientRect.left + element.clientLeft;
  const scale = isHTMLElement(element) ? getScale(element) : createCoords(1);
  const width = element.clientWidth * scale.x;
  const height = element.clientHeight * scale.y;
  const x2 = left * scale.x;
  const y3 = top * scale.y;
  return {
    width,
    height,
    x: x2,
    y: y3
  };
}
function getClientRectFromClippingAncestor(element, clippingAncestor, strategy) {
  let rect;
  if (clippingAncestor === "viewport") {
    rect = getViewportRect(element, strategy);
  } else if (clippingAncestor === "document") {
    rect = getDocumentRect(getDocumentElement(element));
  } else if (isElement(clippingAncestor)) {
    rect = getInnerBoundingClientRect(clippingAncestor, strategy);
  } else {
    const visualOffsets = getVisualOffsets(element);
    rect = {
      x: clippingAncestor.x - visualOffsets.x,
      y: clippingAncestor.y - visualOffsets.y,
      width: clippingAncestor.width,
      height: clippingAncestor.height
    };
  }
  return rectToClientRect(rect);
}
function hasFixedPositionAncestor(element, stopNode) {
  const parentNode = getParentNode(element);
  if (parentNode === stopNode || !isElement(parentNode) || isLastTraversableNode(parentNode)) {
    return false;
  }
  return getComputedStyle2(parentNode).position === "fixed" || hasFixedPositionAncestor(parentNode, stopNode);
}
function getClippingElementAncestors(element, cache) {
  const cachedResult = cache.get(element);
  if (cachedResult) {
    return cachedResult;
  }
  let result = getOverflowAncestors(element, [], false).filter((el) => isElement(el) && getNodeName(el) !== "body");
  let currentContainingBlockComputedStyle = null;
  const elementIsFixed = getComputedStyle2(element).position === "fixed";
  let currentNode = elementIsFixed ? getParentNode(element) : element;
  while (isElement(currentNode) && !isLastTraversableNode(currentNode)) {
    const computedStyle = getComputedStyle2(currentNode);
    const currentNodeIsContaining = isContainingBlock(currentNode);
    if (!currentNodeIsContaining && computedStyle.position === "fixed") {
      currentContainingBlockComputedStyle = null;
    }
    const shouldDropCurrentNode = elementIsFixed ? !currentNodeIsContaining && !currentContainingBlockComputedStyle : !currentNodeIsContaining && computedStyle.position === "static" && !!currentContainingBlockComputedStyle && (currentContainingBlockComputedStyle.position === "absolute" || currentContainingBlockComputedStyle.position === "fixed") || isOverflowElement(currentNode) && !currentNodeIsContaining && hasFixedPositionAncestor(element, currentNode);
    if (shouldDropCurrentNode) {
      result = result.filter((ancestor) => ancestor !== currentNode);
    } else {
      currentContainingBlockComputedStyle = computedStyle;
    }
    currentNode = getParentNode(currentNode);
  }
  cache.set(element, result);
  return result;
}
function getClippingRect(_ref) {
  let {
    element,
    boundary,
    rootBoundary,
    strategy
  } = _ref;
  const elementClippingAncestors = boundary === "clippingAncestors" ? isTopLayer(element) ? [] : getClippingElementAncestors(element, this._c) : [].concat(boundary);
  const clippingAncestors = [...elementClippingAncestors, rootBoundary];
  const firstRect = getClientRectFromClippingAncestor(element, clippingAncestors[0], strategy);
  let top = firstRect.top;
  let right = firstRect.right;
  let bottom = firstRect.bottom;
  let left = firstRect.left;
  for (let i8 = 1; i8 < clippingAncestors.length; i8++) {
    const rect = getClientRectFromClippingAncestor(element, clippingAncestors[i8], strategy);
    top = max(rect.top, top);
    right = min(rect.right, right);
    bottom = min(rect.bottom, bottom);
    left = max(rect.left, left);
  }
  return {
    width: right - left,
    height: bottom - top,
    x: left,
    y: top
  };
}
function getDimensions(element) {
  const {
    width,
    height
  } = getCssDimensions(element);
  return {
    width,
    height
  };
}
function getRectRelativeToOffsetParent(element, offsetParent, strategy) {
  const isOffsetParentAnElement = isHTMLElement(offsetParent);
  const documentElement = getDocumentElement(offsetParent);
  const isFixed = strategy === "fixed";
  const rect = getBoundingClientRect(element, true, isFixed, offsetParent);
  let scroll = {
    scrollLeft: 0,
    scrollTop: 0
  };
  const offsets = createCoords(0);
  function setLeftRTLScrollbarOffset() {
    offsets.x = getWindowScrollBarX(documentElement);
  }
  if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
    if (getNodeName(offsetParent) !== "body" || isOverflowElement(documentElement)) {
      scroll = getNodeScroll(offsetParent);
    }
    if (isOffsetParentAnElement) {
      const offsetRect = getBoundingClientRect(offsetParent, true, isFixed, offsetParent);
      offsets.x = offsetRect.x + offsetParent.clientLeft;
      offsets.y = offsetRect.y + offsetParent.clientTop;
    } else if (documentElement) {
      setLeftRTLScrollbarOffset();
    }
  }
  if (isFixed && !isOffsetParentAnElement && documentElement) {
    setLeftRTLScrollbarOffset();
  }
  const htmlOffset = documentElement && !isOffsetParentAnElement && !isFixed ? getHTMLOffset(documentElement, scroll) : createCoords(0);
  const x2 = rect.left + scroll.scrollLeft - offsets.x - htmlOffset.x;
  const y3 = rect.top + scroll.scrollTop - offsets.y - htmlOffset.y;
  return {
    x: x2,
    y: y3,
    width: rect.width,
    height: rect.height
  };
}
function isStaticPositioned(element) {
  return getComputedStyle2(element).position === "static";
}
function getTrueOffsetParent(element, polyfill) {
  if (!isHTMLElement(element) || getComputedStyle2(element).position === "fixed") {
    return null;
  }
  if (polyfill) {
    return polyfill(element);
  }
  let rawOffsetParent = element.offsetParent;
  if (getDocumentElement(element) === rawOffsetParent) {
    rawOffsetParent = rawOffsetParent.ownerDocument.body;
  }
  return rawOffsetParent;
}
function getOffsetParent(element, polyfill) {
  const win = getWindow(element);
  if (isTopLayer(element)) {
    return win;
  }
  if (!isHTMLElement(element)) {
    let svgOffsetParent = getParentNode(element);
    while (svgOffsetParent && !isLastTraversableNode(svgOffsetParent)) {
      if (isElement(svgOffsetParent) && !isStaticPositioned(svgOffsetParent)) {
        return svgOffsetParent;
      }
      svgOffsetParent = getParentNode(svgOffsetParent);
    }
    return win;
  }
  let offsetParent = getTrueOffsetParent(element, polyfill);
  while (offsetParent && isTableElement(offsetParent) && isStaticPositioned(offsetParent)) {
    offsetParent = getTrueOffsetParent(offsetParent, polyfill);
  }
  if (offsetParent && isLastTraversableNode(offsetParent) && isStaticPositioned(offsetParent) && !isContainingBlock(offsetParent)) {
    return win;
  }
  return offsetParent || getContainingBlock(element) || win;
}
var getElementRects = async function(data) {
  const getOffsetParentFn = this.getOffsetParent || getOffsetParent;
  const getDimensionsFn = this.getDimensions;
  const floatingDimensions = await getDimensionsFn(data.floating);
  return {
    reference: getRectRelativeToOffsetParent(data.reference, await getOffsetParentFn(data.floating), data.strategy),
    floating: {
      x: 0,
      y: 0,
      width: floatingDimensions.width,
      height: floatingDimensions.height
    }
  };
};
function isRTL(element) {
  return getComputedStyle2(element).direction === "rtl";
}
var platform = {
  convertOffsetParentRelativeRectToViewportRelativeRect,
  getDocumentElement,
  getClippingRect,
  getOffsetParent,
  getElementRects,
  getClientRects,
  getDimensions,
  getScale,
  isElement,
  isRTL
};
function rectsAreEqual(a4, b3) {
  return a4.x === b3.x && a4.y === b3.y && a4.width === b3.width && a4.height === b3.height;
}
function observeMove(element, onMove) {
  let io = null;
  let timeoutId;
  const root = getDocumentElement(element);
  function cleanup() {
    var _io;
    clearTimeout(timeoutId);
    (_io = io) == null || _io.disconnect();
    io = null;
  }
  function refresh(skip, threshold) {
    if (skip === void 0) {
      skip = false;
    }
    if (threshold === void 0) {
      threshold = 1;
    }
    cleanup();
    const elementRectForRootMargin = element.getBoundingClientRect();
    const {
      left,
      top,
      width,
      height
    } = elementRectForRootMargin;
    if (!skip) {
      onMove();
    }
    if (!width || !height) {
      return;
    }
    const insetTop = floor(top);
    const insetRight = floor(root.clientWidth - (left + width));
    const insetBottom = floor(root.clientHeight - (top + height));
    const insetLeft = floor(left);
    const rootMargin = -insetTop + "px " + -insetRight + "px " + -insetBottom + "px " + -insetLeft + "px";
    const options = {
      rootMargin,
      threshold: max(0, min(1, threshold)) || 1
    };
    let isFirstUpdate = true;
    function handleObserve(entries) {
      const ratio = entries[0].intersectionRatio;
      if (ratio !== threshold) {
        if (!isFirstUpdate) {
          return refresh();
        }
        if (!ratio) {
          timeoutId = setTimeout(() => {
            refresh(false, 1e-7);
          }, 1e3);
        } else {
          refresh(false, ratio);
        }
      }
      if (ratio === 1 && !rectsAreEqual(elementRectForRootMargin, element.getBoundingClientRect())) {
        refresh();
      }
      isFirstUpdate = false;
    }
    try {
      io = new IntersectionObserver(handleObserve, {
        ...options,
        // Handle <iframe>s
        root: root.ownerDocument
      });
    } catch (_e2) {
      io = new IntersectionObserver(handleObserve, options);
    }
    io.observe(element);
  }
  refresh(true);
  return cleanup;
}
function autoUpdate(reference, floating, update2, options) {
  if (options === void 0) {
    options = {};
  }
  const {
    ancestorScroll = true,
    ancestorResize = true,
    elementResize = typeof ResizeObserver === "function",
    layoutShift = typeof IntersectionObserver === "function",
    animationFrame = false
  } = options;
  const referenceEl = unwrapElement(reference);
  const ancestors = ancestorScroll || ancestorResize ? [...referenceEl ? getOverflowAncestors(referenceEl) : [], ...floating ? getOverflowAncestors(floating) : []] : [];
  ancestors.forEach((ancestor) => {
    ancestorScroll && ancestor.addEventListener("scroll", update2, {
      passive: true
    });
    ancestorResize && ancestor.addEventListener("resize", update2);
  });
  const cleanupIo = referenceEl && layoutShift ? observeMove(referenceEl, update2) : null;
  let reobserveFrame = -1;
  let resizeObserver2 = null;
  if (elementResize) {
    resizeObserver2 = new ResizeObserver((_ref) => {
      let [firstEntry] = _ref;
      if (firstEntry && firstEntry.target === referenceEl && resizeObserver2 && floating) {
        resizeObserver2.unobserve(floating);
        cancelAnimationFrame(reobserveFrame);
        reobserveFrame = requestAnimationFrame(() => {
          var _resizeObserver;
          (_resizeObserver = resizeObserver2) == null || _resizeObserver.observe(floating);
        });
      }
      update2();
    });
    if (referenceEl && !animationFrame) {
      resizeObserver2.observe(referenceEl);
    }
    if (floating) {
      resizeObserver2.observe(floating);
    }
  }
  let frameId;
  let prevRefRect = animationFrame ? getBoundingClientRect(reference) : null;
  if (animationFrame) {
    frameLoop();
  }
  function frameLoop() {
    const nextRefRect = getBoundingClientRect(reference);
    if (prevRefRect && !rectsAreEqual(prevRefRect, nextRefRect)) {
      update2();
    }
    prevRefRect = nextRefRect;
    frameId = requestAnimationFrame(frameLoop);
  }
  update2();
  return () => {
    var _resizeObserver2;
    ancestors.forEach((ancestor) => {
      ancestorScroll && ancestor.removeEventListener("scroll", update2);
      ancestorResize && ancestor.removeEventListener("resize", update2);
    });
    cleanupIo == null || cleanupIo();
    (_resizeObserver2 = resizeObserver2) == null || _resizeObserver2.disconnect();
    resizeObserver2 = null;
    if (animationFrame) {
      cancelAnimationFrame(frameId);
    }
  };
}
var offset2 = offset;
var shift2 = shift;
var flip2 = flip;
var size2 = size;
var arrow2 = arrow;
var computePosition2 = (reference, floating, options) => {
  const cache = /* @__PURE__ */ new Map();
  const mergedOptions = {
    platform,
    ...options
  };
  const platformWithCache = {
    ...mergedOptions.platform,
    _c: cache
  };
  return computePosition(reference, floating, {
    ...mergedOptions,
    platform: platformWithCache
  });
};

// node_modules/composed-offset-position/dist/composed-offset-position.browser.min.mjs
function e9(t6) {
  return i7(t6);
}
function r10(t6) {
  return t6.assignedSlot ? t6.assignedSlot : t6.parentNode instanceof ShadowRoot ? t6.parentNode.host : t6.parentNode;
}
function i7(e10) {
  for (let t6 = e10; t6; t6 = r10(t6)) if (t6 instanceof Element && "none" === getComputedStyle(t6).display) return null;
  for (let n6 = r10(e10); n6; n6 = r10(n6)) {
    if (!(n6 instanceof Element)) continue;
    const e11 = getComputedStyle(n6);
    if ("contents" !== e11.display) {
      if ("static" !== e11.position || isContainingBlock(e11)) return n6;
      if ("BODY" === n6.tagName) return n6;
    }
  }
  return null;
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.5JY5FUCG.js
function isVirtualElement(e10) {
  return e10 !== null && typeof e10 === "object" && "getBoundingClientRect" in e10 && ("contextElement" in e10 ? e10.contextElement instanceof Element : true);
}
var SlPopup = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.active = false;
    this.placement = "top";
    this.strategy = "absolute";
    this.distance = 0;
    this.skidding = 0;
    this.arrow = false;
    this.arrowPlacement = "anchor";
    this.arrowPadding = 10;
    this.flip = false;
    this.flipFallbackPlacements = "";
    this.flipFallbackStrategy = "best-fit";
    this.flipPadding = 0;
    this.shift = false;
    this.shiftPadding = 0;
    this.autoSizePadding = 0;
    this.hoverBridge = false;
    this.updateHoverBridge = () => {
      if (this.hoverBridge && this.anchorEl) {
        const anchorRect = this.anchorEl.getBoundingClientRect();
        const popupRect = this.popup.getBoundingClientRect();
        const isVertical = this.placement.includes("top") || this.placement.includes("bottom");
        let topLeftX = 0;
        let topLeftY = 0;
        let topRightX = 0;
        let topRightY = 0;
        let bottomLeftX = 0;
        let bottomLeftY = 0;
        let bottomRightX = 0;
        let bottomRightY = 0;
        if (isVertical) {
          if (anchorRect.top < popupRect.top) {
            topLeftX = anchorRect.left;
            topLeftY = anchorRect.bottom;
            topRightX = anchorRect.right;
            topRightY = anchorRect.bottom;
            bottomLeftX = popupRect.left;
            bottomLeftY = popupRect.top;
            bottomRightX = popupRect.right;
            bottomRightY = popupRect.top;
          } else {
            topLeftX = popupRect.left;
            topLeftY = popupRect.bottom;
            topRightX = popupRect.right;
            topRightY = popupRect.bottom;
            bottomLeftX = anchorRect.left;
            bottomLeftY = anchorRect.top;
            bottomRightX = anchorRect.right;
            bottomRightY = anchorRect.top;
          }
        } else {
          if (anchorRect.left < popupRect.left) {
            topLeftX = anchorRect.right;
            topLeftY = anchorRect.top;
            topRightX = popupRect.left;
            topRightY = popupRect.top;
            bottomLeftX = anchorRect.right;
            bottomLeftY = anchorRect.bottom;
            bottomRightX = popupRect.left;
            bottomRightY = popupRect.bottom;
          } else {
            topLeftX = popupRect.right;
            topLeftY = popupRect.top;
            topRightX = anchorRect.left;
            topRightY = anchorRect.top;
            bottomLeftX = popupRect.right;
            bottomLeftY = popupRect.bottom;
            bottomRightX = anchorRect.left;
            bottomRightY = anchorRect.bottom;
          }
        }
        this.style.setProperty("--hover-bridge-top-left-x", `${topLeftX}px`);
        this.style.setProperty("--hover-bridge-top-left-y", `${topLeftY}px`);
        this.style.setProperty("--hover-bridge-top-right-x", `${topRightX}px`);
        this.style.setProperty("--hover-bridge-top-right-y", `${topRightY}px`);
        this.style.setProperty("--hover-bridge-bottom-left-x", `${bottomLeftX}px`);
        this.style.setProperty("--hover-bridge-bottom-left-y", `${bottomLeftY}px`);
        this.style.setProperty("--hover-bridge-bottom-right-x", `${bottomRightX}px`);
        this.style.setProperty("--hover-bridge-bottom-right-y", `${bottomRightY}px`);
      }
    };
  }
  async connectedCallback() {
    super.connectedCallback();
    await this.updateComplete;
    this.start();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.stop();
  }
  async updated(changedProps) {
    super.updated(changedProps);
    if (changedProps.has("active")) {
      if (this.active) {
        this.start();
      } else {
        this.stop();
      }
    }
    if (changedProps.has("anchor")) {
      this.handleAnchorChange();
    }
    if (this.active) {
      await this.updateComplete;
      this.reposition();
    }
  }
  async handleAnchorChange() {
    await this.stop();
    if (this.anchor && typeof this.anchor === "string") {
      const root = this.getRootNode();
      this.anchorEl = root.getElementById(this.anchor);
    } else if (this.anchor instanceof Element || isVirtualElement(this.anchor)) {
      this.anchorEl = this.anchor;
    } else {
      this.anchorEl = this.querySelector('[slot="anchor"]');
    }
    if (this.anchorEl instanceof HTMLSlotElement) {
      this.anchorEl = this.anchorEl.assignedElements({ flatten: true })[0];
    }
    if (this.anchorEl && this.active) {
      this.start();
    }
  }
  start() {
    if (!this.anchorEl || !this.active) {
      return;
    }
    this.cleanup = autoUpdate(this.anchorEl, this.popup, () => {
      this.reposition();
    });
  }
  async stop() {
    return new Promise((resolve) => {
      if (this.cleanup) {
        this.cleanup();
        this.cleanup = void 0;
        this.removeAttribute("data-current-placement");
        this.style.removeProperty("--auto-size-available-width");
        this.style.removeProperty("--auto-size-available-height");
        requestAnimationFrame(() => resolve());
      } else {
        resolve();
      }
    });
  }
  /** Forces the popup to recalculate and reposition itself. */
  reposition() {
    if (!this.active || !this.anchorEl) {
      return;
    }
    const middleware = [
      // The offset middleware goes first
      offset2({ mainAxis: this.distance, crossAxis: this.skidding })
    ];
    if (this.sync) {
      middleware.push(
        size2({
          apply: ({ rects }) => {
            const syncWidth = this.sync === "width" || this.sync === "both";
            const syncHeight = this.sync === "height" || this.sync === "both";
            this.popup.style.width = syncWidth ? `${rects.reference.width}px` : "";
            this.popup.style.height = syncHeight ? `${rects.reference.height}px` : "";
          }
        })
      );
    } else {
      this.popup.style.width = "";
      this.popup.style.height = "";
    }
    if (this.flip) {
      middleware.push(
        flip2({
          boundary: this.flipBoundary,
          // @ts-expect-error - We're converting a string attribute to an array here
          fallbackPlacements: this.flipFallbackPlacements,
          fallbackStrategy: this.flipFallbackStrategy === "best-fit" ? "bestFit" : "initialPlacement",
          padding: this.flipPadding
        })
      );
    }
    if (this.shift) {
      middleware.push(
        shift2({
          boundary: this.shiftBoundary,
          padding: this.shiftPadding
        })
      );
    }
    if (this.autoSize) {
      middleware.push(
        size2({
          boundary: this.autoSizeBoundary,
          padding: this.autoSizePadding,
          apply: ({ availableWidth, availableHeight }) => {
            if (this.autoSize === "vertical" || this.autoSize === "both") {
              this.style.setProperty("--auto-size-available-height", `${availableHeight}px`);
            } else {
              this.style.removeProperty("--auto-size-available-height");
            }
            if (this.autoSize === "horizontal" || this.autoSize === "both") {
              this.style.setProperty("--auto-size-available-width", `${availableWidth}px`);
            } else {
              this.style.removeProperty("--auto-size-available-width");
            }
          }
        })
      );
    } else {
      this.style.removeProperty("--auto-size-available-width");
      this.style.removeProperty("--auto-size-available-height");
    }
    if (this.arrow) {
      middleware.push(
        arrow2({
          element: this.arrowEl,
          padding: this.arrowPadding
        })
      );
    }
    const getOffsetParent2 = this.strategy === "absolute" ? (element) => platform.getOffsetParent(element, e9) : platform.getOffsetParent;
    computePosition2(this.anchorEl, this.popup, {
      placement: this.placement,
      middleware,
      strategy: this.strategy,
      platform: __spreadProps(__spreadValues({}, platform), {
        getOffsetParent: getOffsetParent2
      })
    }).then(({ x: x2, y: y3, middlewareData, placement }) => {
      const isRtl = this.localize.dir() === "rtl";
      const staticSide = { top: "bottom", right: "left", bottom: "top", left: "right" }[placement.split("-")[0]];
      this.setAttribute("data-current-placement", placement);
      Object.assign(this.popup.style, {
        left: `${x2}px`,
        top: `${y3}px`
      });
      if (this.arrow) {
        const arrowX = middlewareData.arrow.x;
        const arrowY = middlewareData.arrow.y;
        let top = "";
        let right = "";
        let bottom = "";
        let left = "";
        if (this.arrowPlacement === "start") {
          const value = typeof arrowX === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
          top = typeof arrowY === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
          right = isRtl ? value : "";
          left = isRtl ? "" : value;
        } else if (this.arrowPlacement === "end") {
          const value = typeof arrowX === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
          right = isRtl ? "" : value;
          left = isRtl ? value : "";
          bottom = typeof arrowY === "number" ? `calc(${this.arrowPadding}px - var(--arrow-padding-offset))` : "";
        } else if (this.arrowPlacement === "center") {
          left = typeof arrowX === "number" ? `calc(50% - var(--arrow-size-diagonal))` : "";
          top = typeof arrowY === "number" ? `calc(50% - var(--arrow-size-diagonal))` : "";
        } else {
          left = typeof arrowX === "number" ? `${arrowX}px` : "";
          top = typeof arrowY === "number" ? `${arrowY}px` : "";
        }
        Object.assign(this.arrowEl.style, {
          top,
          right,
          bottom,
          left,
          [staticSide]: "calc(var(--arrow-size-diagonal) * -1)"
        });
      }
    });
    requestAnimationFrame(() => this.updateHoverBridge());
    this.emit("sl-reposition");
  }
  render() {
    return b`
      <slot name="anchor" @slotchange=${this.handleAnchorChange}></slot>

      <span
        part="hover-bridge"
        class=${e8({
      "popup-hover-bridge": true,
      "popup-hover-bridge--visible": this.hoverBridge && this.active
    })}
      ></span>

      <div
        part="popup"
        class=${e8({
      popup: true,
      "popup--active": this.active,
      "popup--fixed": this.strategy === "fixed",
      "popup--has-arrow": this.arrow
    })}
      >
        <slot></slot>
        ${this.arrow ? b`<div part="arrow" class="popup__arrow" role="presentation"></div>` : ""}
      </div>
    `;
  }
};
SlPopup.styles = [component_styles_default, popup_styles_default];
__decorateClass([
  e7(".popup")
], SlPopup.prototype, "popup", 2);
__decorateClass([
  e7(".popup__arrow")
], SlPopup.prototype, "arrowEl", 2);
__decorateClass([
  n4()
], SlPopup.prototype, "anchor", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlPopup.prototype, "active", 2);
__decorateClass([
  n4({ reflect: true })
], SlPopup.prototype, "placement", 2);
__decorateClass([
  n4({ reflect: true })
], SlPopup.prototype, "strategy", 2);
__decorateClass([
  n4({ type: Number })
], SlPopup.prototype, "distance", 2);
__decorateClass([
  n4({ type: Number })
], SlPopup.prototype, "skidding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlPopup.prototype, "arrow", 2);
__decorateClass([
  n4({ attribute: "arrow-placement" })
], SlPopup.prototype, "arrowPlacement", 2);
__decorateClass([
  n4({ attribute: "arrow-padding", type: Number })
], SlPopup.prototype, "arrowPadding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlPopup.prototype, "flip", 2);
__decorateClass([
  n4({
    attribute: "flip-fallback-placements",
    converter: {
      fromAttribute: (value) => {
        return value.split(" ").map((p4) => p4.trim()).filter((p4) => p4 !== "");
      },
      toAttribute: (value) => {
        return value.join(" ");
      }
    }
  })
], SlPopup.prototype, "flipFallbackPlacements", 2);
__decorateClass([
  n4({ attribute: "flip-fallback-strategy" })
], SlPopup.prototype, "flipFallbackStrategy", 2);
__decorateClass([
  n4({ type: Object })
], SlPopup.prototype, "flipBoundary", 2);
__decorateClass([
  n4({ attribute: "flip-padding", type: Number })
], SlPopup.prototype, "flipPadding", 2);
__decorateClass([
  n4({ type: Boolean })
], SlPopup.prototype, "shift", 2);
__decorateClass([
  n4({ type: Object })
], SlPopup.prototype, "shiftBoundary", 2);
__decorateClass([
  n4({ attribute: "shift-padding", type: Number })
], SlPopup.prototype, "shiftPadding", 2);
__decorateClass([
  n4({ attribute: "auto-size" })
], SlPopup.prototype, "autoSize", 2);
__decorateClass([
  n4()
], SlPopup.prototype, "sync", 2);
__decorateClass([
  n4({ type: Object })
], SlPopup.prototype, "autoSizeBoundary", 2);
__decorateClass([
  n4({ attribute: "auto-size-padding", type: Number })
], SlPopup.prototype, "autoSizePadding", 2);
__decorateClass([
  n4({ attribute: "hover-bridge", type: Boolean })
], SlPopup.prototype, "hoverBridge", 2);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.3RPBFEDE.js
var formCollections = /* @__PURE__ */ new WeakMap();
var reportValidityOverloads = /* @__PURE__ */ new WeakMap();
var checkValidityOverloads = /* @__PURE__ */ new WeakMap();
var userInteractedControls = /* @__PURE__ */ new WeakSet();
var interactions = /* @__PURE__ */ new WeakMap();
var FormControlController = class {
  constructor(host, options) {
    this.handleFormData = (event) => {
      const disabled = this.options.disabled(this.host);
      const name = this.options.name(this.host);
      const value = this.options.value(this.host);
      const isButton = this.host.tagName.toLowerCase() === "sl-button";
      if (this.host.isConnected && !disabled && !isButton && typeof name === "string" && name.length > 0 && typeof value !== "undefined") {
        if (Array.isArray(value)) {
          value.forEach((val) => {
            event.formData.append(name, val.toString());
          });
        } else {
          event.formData.append(name, value.toString());
        }
      }
    };
    this.handleFormSubmit = (event) => {
      var _a;
      const disabled = this.options.disabled(this.host);
      const reportValidity = this.options.reportValidity;
      if (this.form && !this.form.noValidate) {
        (_a = formCollections.get(this.form)) == null ? void 0 : _a.forEach((control) => {
          this.setUserInteracted(control, true);
        });
      }
      if (this.form && !this.form.noValidate && !disabled && !reportValidity(this.host)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    this.handleFormReset = () => {
      this.options.setValue(this.host, this.options.defaultValue(this.host));
      this.setUserInteracted(this.host, false);
      interactions.set(this.host, []);
    };
    this.handleInteraction = (event) => {
      const emittedEvents = interactions.get(this.host);
      if (!emittedEvents.includes(event.type)) {
        emittedEvents.push(event.type);
      }
      if (emittedEvents.length === this.options.assumeInteractionOn.length) {
        this.setUserInteracted(this.host, true);
      }
    };
    this.checkFormValidity = () => {
      if (this.form && !this.form.noValidate) {
        const elements = this.form.querySelectorAll("*");
        for (const element of elements) {
          if (typeof element.checkValidity === "function") {
            if (!element.checkValidity()) {
              return false;
            }
          }
        }
      }
      return true;
    };
    this.reportFormValidity = () => {
      if (this.form && !this.form.noValidate) {
        const elements = this.form.querySelectorAll("*");
        for (const element of elements) {
          if (typeof element.reportValidity === "function") {
            if (!element.reportValidity()) {
              return false;
            }
          }
        }
      }
      return true;
    };
    (this.host = host).addController(this);
    this.options = __spreadValues({
      form: (input) => {
        const formId = input.form;
        if (formId) {
          const root = input.getRootNode();
          const form = root.querySelector(`#${formId}`);
          if (form) {
            return form;
          }
        }
        return input.closest("form");
      },
      name: (input) => input.name,
      value: (input) => input.value,
      defaultValue: (input) => input.defaultValue,
      disabled: (input) => {
        var _a;
        return (_a = input.disabled) != null ? _a : false;
      },
      reportValidity: (input) => typeof input.reportValidity === "function" ? input.reportValidity() : true,
      checkValidity: (input) => typeof input.checkValidity === "function" ? input.checkValidity() : true,
      setValue: (input, value) => input.value = value,
      assumeInteractionOn: ["sl-input"]
    }, options);
  }
  hostConnected() {
    const form = this.options.form(this.host);
    if (form) {
      this.attachForm(form);
    }
    interactions.set(this.host, []);
    this.options.assumeInteractionOn.forEach((event) => {
      this.host.addEventListener(event, this.handleInteraction);
    });
  }
  hostDisconnected() {
    this.detachForm();
    interactions.delete(this.host);
    this.options.assumeInteractionOn.forEach((event) => {
      this.host.removeEventListener(event, this.handleInteraction);
    });
  }
  hostUpdated() {
    const form = this.options.form(this.host);
    if (!form) {
      this.detachForm();
    }
    if (form && this.form !== form) {
      this.detachForm();
      this.attachForm(form);
    }
    if (this.host.hasUpdated) {
      this.setValidity(this.host.validity.valid);
    }
  }
  attachForm(form) {
    if (form) {
      this.form = form;
      if (formCollections.has(this.form)) {
        formCollections.get(this.form).add(this.host);
      } else {
        formCollections.set(this.form, /* @__PURE__ */ new Set([this.host]));
      }
      this.form.addEventListener("formdata", this.handleFormData);
      this.form.addEventListener("submit", this.handleFormSubmit);
      this.form.addEventListener("reset", this.handleFormReset);
      if (!reportValidityOverloads.has(this.form)) {
        reportValidityOverloads.set(this.form, this.form.reportValidity);
        this.form.reportValidity = () => this.reportFormValidity();
      }
      if (!checkValidityOverloads.has(this.form)) {
        checkValidityOverloads.set(this.form, this.form.checkValidity);
        this.form.checkValidity = () => this.checkFormValidity();
      }
    } else {
      this.form = void 0;
    }
  }
  detachForm() {
    if (!this.form) return;
    const formCollection = formCollections.get(this.form);
    if (!formCollection) {
      return;
    }
    formCollection.delete(this.host);
    if (formCollection.size <= 0) {
      this.form.removeEventListener("formdata", this.handleFormData);
      this.form.removeEventListener("submit", this.handleFormSubmit);
      this.form.removeEventListener("reset", this.handleFormReset);
      if (reportValidityOverloads.has(this.form)) {
        this.form.reportValidity = reportValidityOverloads.get(this.form);
        reportValidityOverloads.delete(this.form);
      }
      if (checkValidityOverloads.has(this.form)) {
        this.form.checkValidity = checkValidityOverloads.get(this.form);
        checkValidityOverloads.delete(this.form);
      }
      this.form = void 0;
    }
  }
  setUserInteracted(el, hasInteracted) {
    if (hasInteracted) {
      userInteractedControls.add(el);
    } else {
      userInteractedControls.delete(el);
    }
    el.requestUpdate();
  }
  doAction(type, submitter) {
    if (this.form) {
      const button = document.createElement("button");
      button.type = type;
      button.style.position = "absolute";
      button.style.width = "0";
      button.style.height = "0";
      button.style.clipPath = "inset(50%)";
      button.style.overflow = "hidden";
      button.style.whiteSpace = "nowrap";
      if (submitter) {
        button.name = submitter.name;
        button.value = submitter.value;
        ["formaction", "formenctype", "formmethod", "formnovalidate", "formtarget"].forEach((attr) => {
          if (submitter.hasAttribute(attr)) {
            button.setAttribute(attr, submitter.getAttribute(attr));
          }
        });
      }
      this.form.append(button);
      button.click();
      button.remove();
    }
  }
  /** Returns the associated `<form>` element, if one exists. */
  getForm() {
    var _a;
    return (_a = this.form) != null ? _a : null;
  }
  /** Resets the form, restoring all the control to their default value */
  reset(submitter) {
    this.doAction("reset", submitter);
  }
  /** Submits the form, triggering validation and form data injection. */
  submit(submitter) {
    this.doAction("submit", submitter);
  }
  /**
   * Synchronously sets the form control's validity. Call this when you know the future validity but need to update
   * the host element immediately, i.e. before Lit updates the component in the next update.
   */
  setValidity(isValid) {
    const host = this.host;
    const hasInteracted = Boolean(userInteractedControls.has(host));
    const required = Boolean(host.required);
    host.toggleAttribute("data-required", required);
    host.toggleAttribute("data-optional", !required);
    host.toggleAttribute("data-invalid", !isValid);
    host.toggleAttribute("data-valid", isValid);
    host.toggleAttribute("data-user-invalid", !isValid && hasInteracted);
    host.toggleAttribute("data-user-valid", isValid && hasInteracted);
  }
  /**
   * Updates the form control's validity based on the current value of `host.validity.valid`. Call this when anything
   * that affects constraint validation changes so the component receives the correct validity states.
   */
  updateValidity() {
    const host = this.host;
    this.setValidity(host.validity.valid);
  }
  /**
   * Dispatches a non-bubbling, cancelable custom event of type `sl-invalid`.
   * If the `sl-invalid` event will be cancelled then the original `invalid`
   * event (which may have been passed as argument) will also be cancelled.
   * If no original `invalid` event has been passed then the `sl-invalid`
   * event will be cancelled before being dispatched.
   */
  emitInvalidEvent(originalInvalidEvent) {
    const slInvalidEvent = new CustomEvent("sl-invalid", {
      bubbles: false,
      composed: false,
      cancelable: true,
      detail: {}
    });
    if (!originalInvalidEvent) {
      slInvalidEvent.preventDefault();
    }
    if (!this.host.dispatchEvent(slInvalidEvent)) {
      originalInvalidEvent == null ? void 0 : originalInvalidEvent.preventDefault();
    }
  }
};
var validValidityState = Object.freeze({
  badInput: false,
  customError: false,
  patternMismatch: false,
  rangeOverflow: false,
  rangeUnderflow: false,
  stepMismatch: false,
  tooLong: false,
  tooShort: false,
  typeMismatch: false,
  valid: true,
  valueMissing: false
});
var valueMissingValidityState = Object.freeze(__spreadProps(__spreadValues({}, validValidityState), {
  valid: false,
  valueMissing: true
}));
var customErrorValidityState = Object.freeze(__spreadProps(__spreadValues({}, validValidityState), {
  valid: false,
  customError: true
}));

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.NYIIDP5N.js
var HasSlotController = class {
  constructor(host, ...slotNames) {
    this.slotNames = [];
    this.handleSlotChange = (event) => {
      const slot = event.target;
      if (this.slotNames.includes("[default]") && !slot.name || slot.name && this.slotNames.includes(slot.name)) {
        this.host.requestUpdate();
      }
    };
    (this.host = host).addController(this);
    this.slotNames = slotNames;
  }
  hasDefaultSlot() {
    return [...this.host.childNodes].some((node) => {
      if (node.nodeType === node.TEXT_NODE && node.textContent.trim() !== "") {
        return true;
      }
      if (node.nodeType === node.ELEMENT_NODE) {
        const el = node;
        const tagName = el.tagName.toLowerCase();
        if (tagName === "sl-visually-hidden") {
          return false;
        }
        if (!el.hasAttribute("slot")) {
          return true;
        }
      }
      return false;
    });
  }
  hasNamedSlot(name) {
    return this.host.querySelector(`:scope > [slot="${name}"]`) !== null;
  }
  test(slotName) {
    return slotName === "[default]" ? this.hasDefaultSlot() : this.hasNamedSlot(slotName);
  }
  hostConnected() {
    this.host.shadowRoot.addEventListener("slotchange", this.handleSlotChange);
  }
  hostDisconnected() {
    this.host.shadowRoot.removeEventListener("slotchange", this.handleSlotChange);
  }
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.AILU2HNL.js
var SlSelect = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this, {
      assumeInteractionOn: ["sl-blur", "sl-input"]
    });
    this.hasSlotController = new HasSlotController(this, "help-text", "label");
    this.localize = new LocalizeController2(this);
    this.typeToSelectString = "";
    this.hasFocus = false;
    this.displayLabel = "";
    this.selectedOptions = [];
    this.valueHasChanged = false;
    this.name = "";
    this._value = "";
    this.defaultValue = "";
    this.size = "medium";
    this.placeholder = "";
    this.multiple = false;
    this.maxOptionsVisible = 3;
    this.disabled = false;
    this.clearable = false;
    this.open = false;
    this.hoist = false;
    this.filled = false;
    this.pill = false;
    this.label = "";
    this.placement = "bottom";
    this.helpText = "";
    this.form = "";
    this.required = false;
    this.getTag = (option) => {
      return b`
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
        @sl-remove=${(event) => this.handleTagRemove(event, option)}
      >
        ${option.getTextLabel()}
      </sl-tag>
    `;
    };
    this.handleDocumentFocusIn = (event) => {
      const path = event.composedPath();
      if (this && !path.includes(this)) {
        this.hide();
      }
    };
    this.handleDocumentKeyDown = (event) => {
      const target = event.target;
      const isClearButton = target.closest(".select__clear") !== null;
      const isIconButton = target.closest("sl-icon-button") !== null;
      if (isClearButton || isIconButton) {
        return;
      }
      if (event.key === "Escape" && this.open && !this.closeWatcher) {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
        this.displayInput.focus({ preventScroll: true });
      }
      if (event.key === "Enter" || event.key === " " && this.typeToSelectString === "") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.open) {
          this.show();
          return;
        }
        if (this.currentOption && !this.currentOption.disabled) {
          this.valueHasChanged = true;
          if (this.multiple) {
            this.toggleOptionSelection(this.currentOption);
          } else {
            this.setSelectedOptions(this.currentOption);
          }
          this.updateComplete.then(() => {
            this.emit("sl-input");
            this.emit("sl-change");
          });
          if (!this.multiple) {
            this.hide();
            this.displayInput.focus({ preventScroll: true });
          }
        }
        return;
      }
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        const allOptions = this.getAllOptions();
        const currentIndex = allOptions.indexOf(this.currentOption);
        let newIndex = Math.max(0, currentIndex);
        event.preventDefault();
        if (!this.open) {
          this.show();
          if (this.currentOption) {
            return;
          }
        }
        if (event.key === "ArrowDown") {
          newIndex = currentIndex + 1;
          if (newIndex > allOptions.length - 1) newIndex = 0;
        } else if (event.key === "ArrowUp") {
          newIndex = currentIndex - 1;
          if (newIndex < 0) newIndex = allOptions.length - 1;
        } else if (event.key === "Home") {
          newIndex = 0;
        } else if (event.key === "End") {
          newIndex = allOptions.length - 1;
        }
        this.setCurrentOption(allOptions[newIndex]);
      }
      if (event.key && event.key.length === 1 || event.key === "Backspace") {
        const allOptions = this.getAllOptions();
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        if (!this.open) {
          if (event.key === "Backspace") {
            return;
          }
          this.show();
        }
        event.stopPropagation();
        event.preventDefault();
        clearTimeout(this.typeToSelectTimeout);
        this.typeToSelectTimeout = window.setTimeout(() => this.typeToSelectString = "", 1e3);
        if (event.key === "Backspace") {
          this.typeToSelectString = this.typeToSelectString.slice(0, -1);
        } else {
          this.typeToSelectString += event.key.toLowerCase();
        }
        for (const option of allOptions) {
          const label = option.getTextLabel().toLowerCase();
          if (label.startsWith(this.typeToSelectString)) {
            this.setCurrentOption(option);
            break;
          }
        }
      }
    };
    this.handleDocumentMouseDown = (event) => {
      const path = event.composedPath();
      if (this && !path.includes(this)) {
        this.hide();
      }
    };
  }
  get value() {
    return this._value;
  }
  set value(val) {
    if (this.multiple) {
      val = Array.isArray(val) ? val : val.split(" ");
    } else {
      val = Array.isArray(val) ? val.join(" ") : val;
    }
    if (this._value === val) {
      return;
    }
    this.valueHasChanged = true;
    this._value = val;
  }
  /** Gets the validity state object */
  get validity() {
    return this.valueInput.validity;
  }
  /** Gets the validation message */
  get validationMessage() {
    return this.valueInput.validationMessage;
  }
  connectedCallback() {
    super.connectedCallback();
    setTimeout(() => {
      this.handleDefaultSlotChange();
    });
    this.open = false;
  }
  addOpenListeners() {
    var _a;
    document.addEventListener("focusin", this.handleDocumentFocusIn);
    document.addEventListener("keydown", this.handleDocumentKeyDown);
    document.addEventListener("mousedown", this.handleDocumentMouseDown);
    if (this.getRootNode() !== document) {
      this.getRootNode().addEventListener("focusin", this.handleDocumentFocusIn);
    }
    if ("CloseWatcher" in window) {
      (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
      this.closeWatcher = new CloseWatcher();
      this.closeWatcher.onclose = () => {
        if (this.open) {
          this.hide();
          this.displayInput.focus({ preventScroll: true });
        }
      };
    }
  }
  removeOpenListeners() {
    var _a;
    document.removeEventListener("focusin", this.handleDocumentFocusIn);
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
    document.removeEventListener("mousedown", this.handleDocumentMouseDown);
    if (this.getRootNode() !== document) {
      this.getRootNode().removeEventListener("focusin", this.handleDocumentFocusIn);
    }
    (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
  }
  handleFocus() {
    this.hasFocus = true;
    this.displayInput.setSelectionRange(0, 0);
    this.emit("sl-focus");
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleLabelClick() {
    this.displayInput.focus();
  }
  handleComboboxMouseDown(event) {
    const path = event.composedPath();
    const isIconButton = path.some((el) => el instanceof Element && el.tagName.toLowerCase() === "sl-icon-button");
    if (this.disabled || isIconButton) {
      return;
    }
    event.preventDefault();
    this.displayInput.focus({ preventScroll: true });
    this.open = !this.open;
  }
  handleComboboxKeyDown(event) {
    if (event.key === "Tab") {
      return;
    }
    event.stopPropagation();
    this.handleDocumentKeyDown(event);
  }
  handleClearClick(event) {
    event.stopPropagation();
    this.valueHasChanged = true;
    if (this.value !== "") {
      this.setSelectedOptions([]);
      this.displayInput.focus({ preventScroll: true });
      this.updateComplete.then(() => {
        this.emit("sl-clear");
        this.emit("sl-input");
        this.emit("sl-change");
      });
    }
  }
  handleClearMouseDown(event) {
    event.stopPropagation();
    event.preventDefault();
  }
  handleOptionClick(event) {
    const target = event.target;
    const option = target.closest("sl-option");
    const oldValue = this.value;
    if (option && !option.disabled) {
      this.valueHasChanged = true;
      if (this.multiple) {
        this.toggleOptionSelection(option);
      } else {
        this.setSelectedOptions(option);
      }
      this.updateComplete.then(() => this.displayInput.focus({ preventScroll: true }));
      if (this.value !== oldValue) {
        this.updateComplete.then(() => {
          this.emit("sl-input");
          this.emit("sl-change");
        });
      }
      if (!this.multiple) {
        this.hide();
        this.displayInput.focus({ preventScroll: true });
      }
    }
  }
  /* @internal - used by options to update labels */
  handleDefaultSlotChange() {
    if (!customElements.get("sl-option")) {
      customElements.whenDefined("sl-option").then(() => this.handleDefaultSlotChange());
    }
    const allOptions = this.getAllOptions();
    const val = this.valueHasChanged ? this.value : this.defaultValue;
    const value = Array.isArray(val) ? val : [val];
    const values = [];
    allOptions.forEach((option) => values.push(option.value));
    this.setSelectedOptions(allOptions.filter((el) => value.includes(el.value)));
  }
  handleTagRemove(event, option) {
    event.stopPropagation();
    this.valueHasChanged = true;
    if (!this.disabled) {
      this.toggleOptionSelection(option, false);
      this.updateComplete.then(() => {
        this.emit("sl-input");
        this.emit("sl-change");
      });
    }
  }
  // Gets an array of all <sl-option> elements
  getAllOptions() {
    return [...this.querySelectorAll("sl-option")];
  }
  // Gets the first <sl-option> element
  getFirstOption() {
    return this.querySelector("sl-option");
  }
  // Sets the current option, which is the option the user is currently interacting with (e.g. via keyboard). Only one
  // option may be "current" at a time.
  setCurrentOption(option) {
    const allOptions = this.getAllOptions();
    allOptions.forEach((el) => {
      el.current = false;
      el.tabIndex = -1;
    });
    if (option) {
      this.currentOption = option;
      option.current = true;
      option.tabIndex = 0;
      option.focus();
    }
  }
  // Sets the selected option(s)
  setSelectedOptions(option) {
    const allOptions = this.getAllOptions();
    const newSelectedOptions = Array.isArray(option) ? option : [option];
    allOptions.forEach((el) => el.selected = false);
    if (newSelectedOptions.length) {
      newSelectedOptions.forEach((el) => el.selected = true);
    }
    this.selectionChanged();
  }
  // Toggles an option's selected state
  toggleOptionSelection(option, force) {
    if (force === true || force === false) {
      option.selected = force;
    } else {
      option.selected = !option.selected;
    }
    this.selectionChanged();
  }
  // This method must be called whenever the selection changes. It will update the selected options cache, the current
  // value, and the display value
  selectionChanged() {
    var _a, _b, _c;
    const options = this.getAllOptions();
    this.selectedOptions = options.filter((el) => el.selected);
    const cachedValueHasChanged = this.valueHasChanged;
    if (this.multiple) {
      this.value = this.selectedOptions.map((el) => el.value);
      if (this.placeholder && this.value.length === 0) {
        this.displayLabel = "";
      } else {
        this.displayLabel = this.localize.term("numOptionsSelected", this.selectedOptions.length);
      }
    } else {
      const selectedOption = this.selectedOptions[0];
      this.value = (_a = selectedOption == null ? void 0 : selectedOption.value) != null ? _a : "";
      this.displayLabel = (_c = (_b = selectedOption == null ? void 0 : selectedOption.getTextLabel) == null ? void 0 : _b.call(selectedOption)) != null ? _c : "";
    }
    this.valueHasChanged = cachedValueHasChanged;
    this.updateComplete.then(() => {
      this.formControlController.updateValidity();
    });
  }
  get tags() {
    return this.selectedOptions.map((option, index) => {
      if (index < this.maxOptionsVisible || this.maxOptionsVisible <= 0) {
        const tag = this.getTag(option, index);
        return b`<div @sl-remove=${(e10) => this.handleTagRemove(e10, option)}>
          ${typeof tag === "string" ? o2(tag) : tag}
        </div>`;
      } else if (index === this.maxOptionsVisible) {
        return b`<sl-tag size=${this.size}>+${this.selectedOptions.length - index}</sl-tag>`;
      }
      return b``;
    });
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  handleDisabledChange() {
    if (this.disabled) {
      this.open = false;
      this.handleOpenChange();
    }
  }
  attributeChangedCallback(name, oldVal, newVal) {
    super.attributeChangedCallback(name, oldVal, newVal);
    if (name === "value") {
      const cachedValueHasChanged = this.valueHasChanged;
      this.value = this.defaultValue;
      this.valueHasChanged = cachedValueHasChanged;
    }
  }
  handleValueChange() {
    if (!this.valueHasChanged) {
      const cachedValueHasChanged = this.valueHasChanged;
      this.value = this.defaultValue;
      this.valueHasChanged = cachedValueHasChanged;
    }
    const allOptions = this.getAllOptions();
    const value = Array.isArray(this.value) ? this.value : [this.value];
    this.setSelectedOptions(allOptions.filter((el) => value.includes(el.value)));
  }
  async handleOpenChange() {
    if (this.open && !this.disabled) {
      this.setCurrentOption(this.selectedOptions[0] || this.getFirstOption());
      this.emit("sl-show");
      this.addOpenListeners();
      await stopAnimations(this);
      this.listbox.hidden = false;
      this.popup.active = true;
      requestAnimationFrame(() => {
        this.setCurrentOption(this.currentOption);
      });
      const { keyframes, options } = getAnimation(this, "select.show", { dir: this.localize.dir() });
      await animateTo(this.popup.popup, keyframes, options);
      if (this.currentOption) {
        scrollIntoView(this.currentOption, this.listbox, "vertical", "auto");
      }
      this.emit("sl-after-show");
    } else {
      this.emit("sl-hide");
      this.removeOpenListeners();
      await stopAnimations(this);
      const { keyframes, options } = getAnimation(this, "select.hide", { dir: this.localize.dir() });
      await animateTo(this.popup.popup, keyframes, options);
      this.listbox.hidden = true;
      this.popup.active = false;
      this.emit("sl-after-hide");
    }
  }
  /** Shows the listbox. */
  async show() {
    if (this.open || this.disabled) {
      this.open = false;
      return void 0;
    }
    this.open = true;
    return waitForEvent(this, "sl-after-show");
  }
  /** Hides the listbox. */
  async hide() {
    if (!this.open || this.disabled) {
      this.open = false;
      return void 0;
    }
    this.open = false;
    return waitForEvent(this, "sl-after-hide");
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    return this.valueInput.checkValidity();
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    return this.valueInput.reportValidity();
  }
  /** Sets a custom validation message. Pass an empty string to restore validity. */
  setCustomValidity(message) {
    this.valueInput.setCustomValidity(message);
    this.formControlController.updateValidity();
  }
  /** Sets focus on the control. */
  focus(options) {
    this.displayInput.focus(options);
  }
  /** Removes focus from the control. */
  blur() {
    this.displayInput.blur();
  }
  render() {
    const hasLabelSlot = this.hasSlotController.test("label");
    const hasHelpTextSlot = this.hasSlotController.test("help-text");
    const hasLabel = this.label ? true : !!hasLabelSlot;
    const hasHelpText = this.helpText ? true : !!hasHelpTextSlot;
    const hasClearIcon = this.clearable && !this.disabled && this.value.length > 0;
    const isPlaceholderVisible = this.placeholder && this.value && this.value.length <= 0;
    return b`
      <div
        part="form-control"
        class=${e8({
      "form-control": true,
      "form-control--small": this.size === "small",
      "form-control--medium": this.size === "medium",
      "form-control--large": this.size === "large",
      "form-control--has-label": hasLabel,
      "form-control--has-help-text": hasHelpText
    })}
      >
        <label
          id="label"
          part="form-control-label"
          class="form-control__label"
          aria-hidden=${hasLabel ? "false" : "true"}
          @click=${this.handleLabelClick}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <sl-popup
            class=${e8({
      select: true,
      "select--standard": true,
      "select--filled": this.filled,
      "select--pill": this.pill,
      "select--open": this.open,
      "select--disabled": this.disabled,
      "select--multiple": this.multiple,
      "select--focused": this.hasFocus,
      "select--placeholder-visible": isPlaceholderVisible,
      "select--top": this.placement === "top",
      "select--bottom": this.placement === "bottom",
      "select--small": this.size === "small",
      "select--medium": this.size === "medium",
      "select--large": this.size === "large"
    })}
            placement=${this.placement}
            strategy=${this.hoist ? "fixed" : "absolute"}
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
                aria-expanded=${this.open ? "true" : "false"}
                aria-haspopup="listbox"
                aria-labelledby="label"
                aria-disabled=${this.disabled ? "true" : "false"}
                aria-describedby="help-text"
                role="combobox"
                tabindex="0"
                @focus=${this.handleFocus}
                @blur=${this.handleBlur}
              />

              ${this.multiple ? b`<div part="tags" class="select__tags">${this.tags}</div>` : ""}

              <input
                class="select__value-input"
                type="text"
                ?disabled=${this.disabled}
                ?required=${this.required}
                .value=${Array.isArray(this.value) ? this.value.join(", ") : this.value}
                tabindex="-1"
                aria-hidden="true"
                @focus=${() => this.focus()}
                @invalid=${this.handleInvalid}
              />

              ${hasClearIcon ? b`
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
                  ` : ""}

              <slot name="suffix" part="suffix" class="select__suffix"></slot>

              <slot name="expand-icon" part="expand-icon" class="select__expand-icon">
                <sl-icon library="system" name="chevron-down"></sl-icon>
              </slot>
            </div>

            <div
              id="listbox"
              role="listbox"
              aria-expanded=${this.open ? "true" : "false"}
              aria-multiselectable=${this.multiple ? "true" : "false"}
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
          aria-hidden=${hasHelpText ? "false" : "true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `;
  }
};
SlSelect.styles = [component_styles_default, form_control_styles_default, select_styles_default];
SlSelect.dependencies = {
  "sl-icon": SlIcon,
  "sl-popup": SlPopup,
  "sl-tag": SlTag
};
__decorateClass([
  e7(".select")
], SlSelect.prototype, "popup", 2);
__decorateClass([
  e7(".select__combobox")
], SlSelect.prototype, "combobox", 2);
__decorateClass([
  e7(".select__display-input")
], SlSelect.prototype, "displayInput", 2);
__decorateClass([
  e7(".select__value-input")
], SlSelect.prototype, "valueInput", 2);
__decorateClass([
  e7(".select__listbox")
], SlSelect.prototype, "listbox", 2);
__decorateClass([
  r8()
], SlSelect.prototype, "hasFocus", 2);
__decorateClass([
  r8()
], SlSelect.prototype, "displayLabel", 2);
__decorateClass([
  r8()
], SlSelect.prototype, "currentOption", 2);
__decorateClass([
  r8()
], SlSelect.prototype, "selectedOptions", 2);
__decorateClass([
  r8()
], SlSelect.prototype, "valueHasChanged", 2);
__decorateClass([
  n4()
], SlSelect.prototype, "name", 2);
__decorateClass([
  r8()
], SlSelect.prototype, "value", 1);
__decorateClass([
  n4({ attribute: "value" })
], SlSelect.prototype, "defaultValue", 2);
__decorateClass([
  n4({ reflect: true })
], SlSelect.prototype, "size", 2);
__decorateClass([
  n4()
], SlSelect.prototype, "placeholder", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSelect.prototype, "multiple", 2);
__decorateClass([
  n4({ attribute: "max-options-visible", type: Number })
], SlSelect.prototype, "maxOptionsVisible", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSelect.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Boolean })
], SlSelect.prototype, "clearable", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSelect.prototype, "open", 2);
__decorateClass([
  n4({ type: Boolean })
], SlSelect.prototype, "hoist", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSelect.prototype, "filled", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSelect.prototype, "pill", 2);
__decorateClass([
  n4()
], SlSelect.prototype, "label", 2);
__decorateClass([
  n4({ reflect: true })
], SlSelect.prototype, "placement", 2);
__decorateClass([
  n4({ attribute: "help-text" })
], SlSelect.prototype, "helpText", 2);
__decorateClass([
  n4({ reflect: true })
], SlSelect.prototype, "form", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSelect.prototype, "required", 2);
__decorateClass([
  n4()
], SlSelect.prototype, "getTag", 2);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlSelect.prototype, "handleDisabledChange", 1);
__decorateClass([
  watch(["defaultValue", "value"], { waitUntilFirstUpdate: true })
], SlSelect.prototype, "handleValueChange", 1);
__decorateClass([
  watch("open", { waitUntilFirstUpdate: true })
], SlSelect.prototype, "handleOpenChange", 1);
setDefaultAnimation("select.show", {
  keyframes: [
    { opacity: 0, scale: 0.9 },
    { opacity: 1, scale: 1 }
  ],
  options: { duration: 100, easing: "ease" }
});
setDefaultAnimation("select.hide", {
  keyframes: [
    { opacity: 1, scale: 1 },
    { opacity: 0, scale: 0.9 }
  ],
  options: { duration: 100, easing: "ease" }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.TP2GB2HO.js
SlSelect.define("sl-select");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.FXXKMG2P.js
var option_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.BBCWSAUE.js
var SlOption = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.isInitialized = false;
    this.current = false;
    this.selected = false;
    this.hasHover = false;
    this.value = "";
    this.disabled = false;
  }
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "option");
    this.setAttribute("aria-selected", "false");
  }
  handleDefaultSlotChange() {
    if (this.isInitialized) {
      customElements.whenDefined("sl-select").then(() => {
        const controller = this.closest("sl-select");
        if (controller) {
          controller.handleDefaultSlotChange();
        }
      });
    } else {
      this.isInitialized = true;
    }
  }
  handleMouseEnter() {
    this.hasHover = true;
  }
  handleMouseLeave() {
    this.hasHover = false;
  }
  handleDisabledChange() {
    this.setAttribute("aria-disabled", this.disabled ? "true" : "false");
  }
  handleSelectedChange() {
    this.setAttribute("aria-selected", this.selected ? "true" : "false");
  }
  handleValueChange() {
    if (typeof this.value !== "string") {
      this.value = String(this.value);
    }
    if (this.value.includes(" ")) {
      console.error(`Option values cannot include a space. All spaces have been replaced with underscores.`, this);
      this.value = this.value.replace(/ /g, "_");
    }
  }
  /** Returns a plain text label based on the option's content. */
  getTextLabel() {
    const nodes = this.childNodes;
    let label = "";
    [...nodes].forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!node.hasAttribute("slot")) {
          label += node.textContent;
        }
      }
      if (node.nodeType === Node.TEXT_NODE) {
        label += node.textContent;
      }
    });
    return label.trim();
  }
  render() {
    return b`
      <div
        part="base"
        class=${e8({
      option: true,
      "option--current": this.current,
      "option--disabled": this.disabled,
      "option--selected": this.selected,
      "option--hover": this.hasHover
    })}
        @mouseenter=${this.handleMouseEnter}
        @mouseleave=${this.handleMouseLeave}
      >
        <sl-icon part="checked-icon" class="option__check" name="check" library="system" aria-hidden="true"></sl-icon>
        <slot part="prefix" name="prefix" class="option__prefix"></slot>
        <slot part="label" class="option__label" @slotchange=${this.handleDefaultSlotChange}></slot>
        <slot part="suffix" name="suffix" class="option__suffix"></slot>
      </div>
    `;
  }
};
SlOption.styles = [component_styles_default, option_styles_default];
SlOption.dependencies = { "sl-icon": SlIcon };
__decorateClass([
  e7(".option__label")
], SlOption.prototype, "defaultSlot", 2);
__decorateClass([
  r8()
], SlOption.prototype, "current", 2);
__decorateClass([
  r8()
], SlOption.prototype, "selected", 2);
__decorateClass([
  r8()
], SlOption.prototype, "hasHover", 2);
__decorateClass([
  n4({ reflect: true })
], SlOption.prototype, "value", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlOption.prototype, "disabled", 2);
__decorateClass([
  watch("disabled")
], SlOption.prototype, "handleDisabledChange", 1);
__decorateClass([
  watch("selected")
], SlOption.prototype, "handleSelectedChange", 1);
__decorateClass([
  watch("value")
], SlOption.prototype, "handleValueChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.JXOKFADN.js
SlOption.define("sl-option");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GGT72J62.js
var input_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GI7VDIWX.js
var defaultValue = (propertyName = "value") => (proto, key) => {
  const ctor = proto.constructor;
  const attributeChangedCallback = ctor.prototype.attributeChangedCallback;
  ctor.prototype.attributeChangedCallback = function(name, old, value) {
    var _a;
    const options = ctor.getPropertyOptions(propertyName);
    const attributeName = typeof options.attribute === "string" ? options.attribute : propertyName;
    if (name === attributeName) {
      const converter = options.converter || u2;
      const fromAttribute = typeof converter === "function" ? converter : (_a = converter == null ? void 0 : converter.fromAttribute) != null ? _a : u2.fromAttribute;
      const newValue = fromAttribute(value, options.type);
      if (this[propertyName] !== newValue) {
        this[key] = newValue;
      }
    }
    attributeChangedCallback.call(this, name, old, value);
  };
};

// node_modules/lit-html/directives/live.js
var l5 = e2(class extends i2 {
  constructor(r11) {
    if (super(r11), r11.type !== t2.PROPERTY && r11.type !== t2.ATTRIBUTE && r11.type !== t2.BOOLEAN_ATTRIBUTE) throw Error("The `live` directive is not allowed on child or event bindings");
    if (!r9(r11)) throw Error("`live` bindings can only contain a single expression");
  }
  render(r11) {
    return r11;
  }
  update(i8, [t6]) {
    if (t6 === E || t6 === A) return t6;
    const o10 = i8.element, l6 = i8.name;
    if (i8.type === t2.PROPERTY) {
      if (t6 === o10[l6]) return E;
    } else if (i8.type === t2.BOOLEAN_ATTRIBUTE) {
      if (!!t6 === o10.hasAttribute(l6)) return E;
    } else if (i8.type === t2.ATTRIBUTE && o10.getAttribute(l6) === t6 + "") return E;
    return p3(i8), t6;
  }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.VM65NPGC.js
var SlInput = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this, {
      assumeInteractionOn: ["sl-blur", "sl-input"]
    });
    this.hasSlotController = new HasSlotController(this, "help-text", "label");
    this.localize = new LocalizeController2(this);
    this.hasFocus = false;
    this.title = "";
    this.__numberInput = Object.assign(document.createElement("input"), { type: "number" });
    this.__dateInput = Object.assign(document.createElement("input"), { type: "date" });
    this.type = "text";
    this.name = "";
    this.value = "";
    this.defaultValue = "";
    this.size = "medium";
    this.filled = false;
    this.pill = false;
    this.label = "";
    this.helpText = "";
    this.clearable = false;
    this.disabled = false;
    this.placeholder = "";
    this.readonly = false;
    this.passwordToggle = false;
    this.passwordVisible = false;
    this.noSpinButtons = false;
    this.form = "";
    this.required = false;
    this.spellcheck = true;
  }
  //
  // NOTE: We use an in-memory input for these getters/setters instead of the one in the template because the properties
  // can be set before the component is rendered.
  //
  /**
   * Gets or sets the current value as a `Date` object. Returns `null` if the value can't be converted. This will use the native `<input type="{{type}}">` implementation and may result in an error.
   */
  get valueAsDate() {
    var _a;
    this.__dateInput.type = this.type;
    this.__dateInput.value = this.value;
    return ((_a = this.input) == null ? void 0 : _a.valueAsDate) || this.__dateInput.valueAsDate;
  }
  set valueAsDate(newValue) {
    this.__dateInput.type = this.type;
    this.__dateInput.valueAsDate = newValue;
    this.value = this.__dateInput.value;
  }
  /** Gets or sets the current value as a number. Returns `NaN` if the value can't be converted. */
  get valueAsNumber() {
    var _a;
    this.__numberInput.value = this.value;
    return ((_a = this.input) == null ? void 0 : _a.valueAsNumber) || this.__numberInput.valueAsNumber;
  }
  set valueAsNumber(newValue) {
    this.__numberInput.valueAsNumber = newValue;
    this.value = this.__numberInput.value;
  }
  /** Gets the validity state object */
  get validity() {
    return this.input.validity;
  }
  /** Gets the validation message */
  get validationMessage() {
    return this.input.validationMessage;
  }
  firstUpdated() {
    this.formControlController.updateValidity();
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleChange() {
    this.value = this.input.value;
    this.emit("sl-change");
  }
  handleClearClick(event) {
    event.preventDefault();
    if (this.value !== "") {
      this.value = "";
      this.emit("sl-clear");
      this.emit("sl-input");
      this.emit("sl-change");
    }
    this.input.focus();
  }
  handleFocus() {
    this.hasFocus = true;
    this.emit("sl-focus");
  }
  handleInput() {
    this.value = this.input.value;
    this.formControlController.updateValidity();
    this.emit("sl-input");
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  handleKeyDown(event) {
    const hasModifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.key === "Enter" && !hasModifier) {
      setTimeout(() => {
        if (!event.defaultPrevented && !event.isComposing) {
          this.formControlController.submit();
        }
      });
    }
  }
  handlePasswordToggle() {
    this.passwordVisible = !this.passwordVisible;
  }
  handleDisabledChange() {
    this.formControlController.setValidity(this.disabled);
  }
  handleStepChange() {
    this.input.step = String(this.step);
    this.formControlController.updateValidity();
  }
  async handleValueChange() {
    await this.updateComplete;
    this.formControlController.updateValidity();
  }
  /** Sets focus on the input. */
  focus(options) {
    this.input.focus(options);
  }
  /** Removes focus from the input. */
  blur() {
    this.input.blur();
  }
  /** Selects all the text in the input. */
  select() {
    this.input.select();
  }
  /** Sets the start and end positions of the text selection (0-based). */
  setSelectionRange(selectionStart, selectionEnd, selectionDirection = "none") {
    this.input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  }
  /** Replaces a range of text with a new string. */
  setRangeText(replacement, start, end, selectMode = "preserve") {
    const selectionStart = start != null ? start : this.input.selectionStart;
    const selectionEnd = end != null ? end : this.input.selectionEnd;
    this.input.setRangeText(replacement, selectionStart, selectionEnd, selectMode);
    if (this.value !== this.input.value) {
      this.value = this.input.value;
    }
  }
  /** Displays the browser picker for an input element (only works if the browser supports it for the input type). */
  showPicker() {
    if ("showPicker" in HTMLInputElement.prototype) {
      this.input.showPicker();
    }
  }
  /** Increments the value of a numeric input type by the value of the step attribute. */
  stepUp() {
    this.input.stepUp();
    if (this.value !== this.input.value) {
      this.value = this.input.value;
    }
  }
  /** Decrements the value of a numeric input type by the value of the step attribute. */
  stepDown() {
    this.input.stepDown();
    if (this.value !== this.input.value) {
      this.value = this.input.value;
    }
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    return this.input.checkValidity();
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    return this.input.reportValidity();
  }
  /** Sets a custom validation message. Pass an empty string to restore validity. */
  setCustomValidity(message) {
    this.input.setCustomValidity(message);
    this.formControlController.updateValidity();
  }
  render() {
    const hasLabelSlot = this.hasSlotController.test("label");
    const hasHelpTextSlot = this.hasSlotController.test("help-text");
    const hasLabel = this.label ? true : !!hasLabelSlot;
    const hasHelpText = this.helpText ? true : !!hasHelpTextSlot;
    const hasClearIcon = this.clearable && !this.disabled && !this.readonly;
    const isClearIconVisible = hasClearIcon && (typeof this.value === "number" || this.value.length > 0);
    return b`
      <div
        part="form-control"
        class=${e8({
      "form-control": true,
      "form-control--small": this.size === "small",
      "form-control--medium": this.size === "medium",
      "form-control--large": this.size === "large",
      "form-control--has-label": hasLabel,
      "form-control--has-help-text": hasHelpText
    })}
      >
        <label
          part="form-control-label"
          class="form-control__label"
          for="input"
          aria-hidden=${hasLabel ? "false" : "true"}
        >
          <slot name="label">${this.label}</slot>
        </label>

        <div part="form-control-input" class="form-control-input">
          <div
            part="base"
            class=${e8({
      input: true,
      // Sizes
      "input--small": this.size === "small",
      "input--medium": this.size === "medium",
      "input--large": this.size === "large",
      // States
      "input--pill": this.pill,
      "input--standard": !this.filled,
      "input--filled": this.filled,
      "input--disabled": this.disabled,
      "input--focused": this.hasFocus,
      "input--empty": !this.value,
      "input--no-spin-buttons": this.noSpinButtons
    })}
          >
            <span part="prefix" class="input__prefix">
              <slot name="prefix"></slot>
            </span>

            <input
              part="input"
              id="input"
              class="input__control"
              type=${this.type === "password" && this.passwordVisible ? "text" : this.type}
              title=${this.title}
              name=${o9(this.name)}
              ?disabled=${this.disabled}
              ?readonly=${this.readonly}
              ?required=${this.required}
              placeholder=${o9(this.placeholder)}
              minlength=${o9(this.minlength)}
              maxlength=${o9(this.maxlength)}
              min=${o9(this.min)}
              max=${o9(this.max)}
              step=${o9(this.step)}
              .value=${l5(this.value)}
              autocapitalize=${o9(this.autocapitalize)}
              autocomplete=${o9(this.autocomplete)}
              autocorrect=${o9(this.autocorrect)}
              ?autofocus=${this.autofocus}
              spellcheck=${this.spellcheck}
              pattern=${o9(this.pattern)}
              enterkeyhint=${o9(this.enterkeyhint)}
              inputmode=${o9(this.inputmode)}
              aria-describedby="help-text"
              @change=${this.handleChange}
              @input=${this.handleInput}
              @invalid=${this.handleInvalid}
              @keydown=${this.handleKeyDown}
              @focus=${this.handleFocus}
              @blur=${this.handleBlur}
            />

            ${isClearIconVisible ? b`
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
                ` : ""}
            ${this.passwordToggle && !this.disabled ? b`
                  <button
                    part="password-toggle-button"
                    class="input__password-toggle"
                    type="button"
                    aria-label=${this.localize.term(this.passwordVisible ? "hidePassword" : "showPassword")}
                    @click=${this.handlePasswordToggle}
                    tabindex="-1"
                  >
                    ${this.passwordVisible ? b`
                          <slot name="show-password-icon">
                            <sl-icon name="eye-slash" library="system"></sl-icon>
                          </slot>
                        ` : b`
                          <slot name="hide-password-icon">
                            <sl-icon name="eye" library="system"></sl-icon>
                          </slot>
                        `}
                  </button>
                ` : ""}

            <span part="suffix" class="input__suffix">
              <slot name="suffix"></slot>
            </span>
          </div>
        </div>

        <div
          part="form-control-help-text"
          id="help-text"
          class="form-control__help-text"
          aria-hidden=${hasHelpText ? "false" : "true"}
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `;
  }
};
SlInput.styles = [component_styles_default, form_control_styles_default, input_styles_default];
SlInput.dependencies = { "sl-icon": SlIcon };
__decorateClass([
  e7(".input__control")
], SlInput.prototype, "input", 2);
__decorateClass([
  r8()
], SlInput.prototype, "hasFocus", 2);
__decorateClass([
  n4()
], SlInput.prototype, "title", 2);
__decorateClass([
  n4({ reflect: true })
], SlInput.prototype, "type", 2);
__decorateClass([
  n4()
], SlInput.prototype, "name", 2);
__decorateClass([
  n4()
], SlInput.prototype, "value", 2);
__decorateClass([
  defaultValue()
], SlInput.prototype, "defaultValue", 2);
__decorateClass([
  n4({ reflect: true })
], SlInput.prototype, "size", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "filled", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "pill", 2);
__decorateClass([
  n4()
], SlInput.prototype, "label", 2);
__decorateClass([
  n4({ attribute: "help-text" })
], SlInput.prototype, "helpText", 2);
__decorateClass([
  n4({ type: Boolean })
], SlInput.prototype, "clearable", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "disabled", 2);
__decorateClass([
  n4()
], SlInput.prototype, "placeholder", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "readonly", 2);
__decorateClass([
  n4({ attribute: "password-toggle", type: Boolean })
], SlInput.prototype, "passwordToggle", 2);
__decorateClass([
  n4({ attribute: "password-visible", type: Boolean })
], SlInput.prototype, "passwordVisible", 2);
__decorateClass([
  n4({ attribute: "no-spin-buttons", type: Boolean })
], SlInput.prototype, "noSpinButtons", 2);
__decorateClass([
  n4({ reflect: true })
], SlInput.prototype, "form", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlInput.prototype, "required", 2);
__decorateClass([
  n4()
], SlInput.prototype, "pattern", 2);
__decorateClass([
  n4({ type: Number })
], SlInput.prototype, "minlength", 2);
__decorateClass([
  n4({ type: Number })
], SlInput.prototype, "maxlength", 2);
__decorateClass([
  n4()
], SlInput.prototype, "min", 2);
__decorateClass([
  n4()
], SlInput.prototype, "max", 2);
__decorateClass([
  n4()
], SlInput.prototype, "step", 2);
__decorateClass([
  n4()
], SlInput.prototype, "autocapitalize", 2);
__decorateClass([
  n4()
], SlInput.prototype, "autocorrect", 2);
__decorateClass([
  n4()
], SlInput.prototype, "autocomplete", 2);
__decorateClass([
  n4({ type: Boolean })
], SlInput.prototype, "autofocus", 2);
__decorateClass([
  n4()
], SlInput.prototype, "enterkeyhint", 2);
__decorateClass([
  n4({
    type: Boolean,
    converter: {
      // Allow "true|false" attribute values but keep the property boolean
      fromAttribute: (value) => !value || value === "false" ? false : true,
      toAttribute: (value) => value ? "true" : "false"
    }
  })
], SlInput.prototype, "spellcheck", 2);
__decorateClass([
  n4()
], SlInput.prototype, "inputmode", 2);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlInput.prototype, "handleDisabledChange", 1);
__decorateClass([
  watch("step", { waitUntilFirstUpdate: true })
], SlInput.prototype, "handleStepChange", 1);
__decorateClass([
  watch("value", { waitUntilFirstUpdate: true })
], SlInput.prototype, "handleValueChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.XA43ZQPC.js
SlInput.define("sl-input");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.7DUCI5S4.js
var spinner_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.36O46B5H.js
var SlSpinner = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
  }
  render() {
    return b`
      <svg part="base" class="spinner" role="progressbar" aria-label=${this.localize.term("loading")}>
        <circle class="spinner__track"></circle>
        <circle class="spinner__indicator"></circle>
      </svg>
    `;
  }
};
SlSpinner.styles = [component_styles_default, spinner_styles_default];

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.MAQXLKQ7.js
var button_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.SBCFYC2S.js
var SlButton = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this, {
      assumeInteractionOn: ["click"]
    });
    this.hasSlotController = new HasSlotController(this, "[default]", "prefix", "suffix");
    this.localize = new LocalizeController2(this);
    this.hasFocus = false;
    this.invalid = false;
    this.title = "";
    this.variant = "default";
    this.size = "medium";
    this.caret = false;
    this.disabled = false;
    this.loading = false;
    this.outline = false;
    this.pill = false;
    this.circle = false;
    this.type = "button";
    this.name = "";
    this.value = "";
    this.href = "";
    this.rel = "noreferrer noopener";
  }
  /** Gets the validity state object */
  get validity() {
    if (this.isButton()) {
      return this.button.validity;
    }
    return validValidityState;
  }
  /** Gets the validation message */
  get validationMessage() {
    if (this.isButton()) {
      return this.button.validationMessage;
    }
    return "";
  }
  firstUpdated() {
    if (this.isButton()) {
      this.formControlController.updateValidity();
    }
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleFocus() {
    this.hasFocus = true;
    this.emit("sl-focus");
  }
  handleClick() {
    if (this.type === "submit") {
      this.formControlController.submit(this);
    }
    if (this.type === "reset") {
      this.formControlController.reset(this);
    }
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  isButton() {
    return this.href ? false : true;
  }
  isLink() {
    return this.href ? true : false;
  }
  handleDisabledChange() {
    if (this.isButton()) {
      this.formControlController.setValidity(this.disabled);
    }
  }
  /** Simulates a click on the button. */
  click() {
    this.button.click();
  }
  /** Sets focus on the button. */
  focus(options) {
    this.button.focus(options);
  }
  /** Removes focus from the button. */
  blur() {
    this.button.blur();
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    if (this.isButton()) {
      return this.button.checkValidity();
    }
    return true;
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    if (this.isButton()) {
      return this.button.reportValidity();
    }
    return true;
  }
  /** Sets a custom validation message. Pass an empty string to restore validity. */
  setCustomValidity(message) {
    if (this.isButton()) {
      this.button.setCustomValidity(message);
      this.formControlController.updateValidity();
    }
  }
  render() {
    const isLink = this.isLink();
    const tag = isLink ? i6`a` : i6`button`;
    return u3`
      <${tag}
        part="base"
        class=${e8({
      button: true,
      "button--default": this.variant === "default",
      "button--primary": this.variant === "primary",
      "button--success": this.variant === "success",
      "button--neutral": this.variant === "neutral",
      "button--warning": this.variant === "warning",
      "button--danger": this.variant === "danger",
      "button--text": this.variant === "text",
      "button--small": this.size === "small",
      "button--medium": this.size === "medium",
      "button--large": this.size === "large",
      "button--caret": this.caret,
      "button--circle": this.circle,
      "button--disabled": this.disabled,
      "button--focused": this.hasFocus,
      "button--loading": this.loading,
      "button--standard": !this.outline,
      "button--outline": this.outline,
      "button--pill": this.pill,
      "button--rtl": this.localize.dir() === "rtl",
      "button--has-label": this.hasSlotController.test("[default]"),
      "button--has-prefix": this.hasSlotController.test("prefix"),
      "button--has-suffix": this.hasSlotController.test("suffix")
    })}
        ?disabled=${o9(isLink ? void 0 : this.disabled)}
        type=${o9(isLink ? void 0 : this.type)}
        title=${this.title}
        name=${o9(isLink ? void 0 : this.name)}
        value=${o9(isLink ? void 0 : this.value)}
        href=${o9(isLink && !this.disabled ? this.href : void 0)}
        target=${o9(isLink ? this.target : void 0)}
        download=${o9(isLink ? this.download : void 0)}
        rel=${o9(isLink ? this.rel : void 0)}
        role=${o9(isLink ? void 0 : "button")}
        aria-disabled=${this.disabled ? "true" : "false"}
        tabindex=${this.disabled ? "-1" : "0"}
        @blur=${this.handleBlur}
        @focus=${this.handleFocus}
        @invalid=${this.isButton() ? this.handleInvalid : null}
        @click=${this.handleClick}
      >
        <slot name="prefix" part="prefix" class="button__prefix"></slot>
        <slot part="label" class="button__label"></slot>
        <slot name="suffix" part="suffix" class="button__suffix"></slot>
        ${this.caret ? u3` <sl-icon part="caret" class="button__caret" library="system" name="caret"></sl-icon> ` : ""}
        ${this.loading ? u3`<sl-spinner part="spinner"></sl-spinner>` : ""}
      </${tag}>
    `;
  }
};
SlButton.styles = [component_styles_default, button_styles_default];
SlButton.dependencies = {
  "sl-icon": SlIcon,
  "sl-spinner": SlSpinner
};
__decorateClass([
  e7(".button")
], SlButton.prototype, "button", 2);
__decorateClass([
  r8()
], SlButton.prototype, "hasFocus", 2);
__decorateClass([
  r8()
], SlButton.prototype, "invalid", 2);
__decorateClass([
  n4()
], SlButton.prototype, "title", 2);
__decorateClass([
  n4({ reflect: true })
], SlButton.prototype, "variant", 2);
__decorateClass([
  n4({ reflect: true })
], SlButton.prototype, "size", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlButton.prototype, "caret", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlButton.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlButton.prototype, "loading", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlButton.prototype, "outline", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlButton.prototype, "pill", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlButton.prototype, "circle", 2);
__decorateClass([
  n4()
], SlButton.prototype, "type", 2);
__decorateClass([
  n4()
], SlButton.prototype, "name", 2);
__decorateClass([
  n4()
], SlButton.prototype, "value", 2);
__decorateClass([
  n4()
], SlButton.prototype, "href", 2);
__decorateClass([
  n4()
], SlButton.prototype, "target", 2);
__decorateClass([
  n4()
], SlButton.prototype, "rel", 2);
__decorateClass([
  n4()
], SlButton.prototype, "download", 2);
__decorateClass([
  n4()
], SlButton.prototype, "form", 2);
__decorateClass([
  n4({ attribute: "formaction" })
], SlButton.prototype, "formAction", 2);
__decorateClass([
  n4({ attribute: "formenctype" })
], SlButton.prototype, "formEnctype", 2);
__decorateClass([
  n4({ attribute: "formmethod" })
], SlButton.prototype, "formMethod", 2);
__decorateClass([
  n4({ attribute: "formnovalidate", type: Boolean })
], SlButton.prototype, "formNoValidate", 2);
__decorateClass([
  n4({ attribute: "formtarget" })
], SlButton.prototype, "formTarget", 2);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlButton.prototype, "handleDisabledChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.JCXLDPQF.js
SlButton.define("sl-button");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.WQC6OWUE.js
var badge_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.NKY3SXQM.js
var SlBadge = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.variant = "primary";
    this.pill = false;
    this.pulse = false;
  }
  render() {
    return b`
      <span
        part="base"
        class=${e8({
      badge: true,
      "badge--primary": this.variant === "primary",
      "badge--success": this.variant === "success",
      "badge--neutral": this.variant === "neutral",
      "badge--warning": this.variant === "warning",
      "badge--danger": this.variant === "danger",
      "badge--pill": this.pill,
      "badge--pulse": this.pulse
    })}
        role="status"
      >
        <slot></slot>
      </span>
    `;
  }
};
SlBadge.styles = [component_styles_default, badge_styles_default];
__decorateClass([
  n4({ reflect: true })
], SlBadge.prototype, "variant", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlBadge.prototype, "pill", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlBadge.prototype, "pulse", 2);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.XO2J2P6J.js
SlBadge.define("sl-badge");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.FW7UWQXB.js
var tooltip_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.NU24CZHH.js
var SlTooltip = class extends ShoelaceElement {
  constructor() {
    super();
    this.localize = new LocalizeController2(this);
    this.content = "";
    this.placement = "top";
    this.disabled = false;
    this.distance = 8;
    this.open = false;
    this.skidding = 0;
    this.trigger = "hover focus";
    this.hoist = false;
    this.handleBlur = () => {
      if (this.hasTrigger("focus")) {
        this.hide();
      }
    };
    this.handleClick = () => {
      if (this.hasTrigger("click")) {
        if (this.open) {
          this.hide();
        } else {
          this.show();
        }
      }
    };
    this.handleFocus = () => {
      if (this.hasTrigger("focus")) {
        this.show();
      }
    };
    this.handleDocumentKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.hide();
      }
    };
    this.handleMouseOver = () => {
      if (this.hasTrigger("hover")) {
        const delay = parseDuration(getComputedStyle(this).getPropertyValue("--show-delay"));
        clearTimeout(this.hoverTimeout);
        this.hoverTimeout = window.setTimeout(() => this.show(), delay);
      }
    };
    this.handleMouseOut = () => {
      if (this.hasTrigger("hover")) {
        const delay = parseDuration(getComputedStyle(this).getPropertyValue("--hide-delay"));
        clearTimeout(this.hoverTimeout);
        this.hoverTimeout = window.setTimeout(() => this.hide(), delay);
      }
    };
    this.addEventListener("blur", this.handleBlur, true);
    this.addEventListener("focus", this.handleFocus, true);
    this.addEventListener("click", this.handleClick);
    this.addEventListener("mouseover", this.handleMouseOver);
    this.addEventListener("mouseout", this.handleMouseOut);
  }
  disconnectedCallback() {
    var _a;
    super.disconnectedCallback();
    (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
  }
  firstUpdated() {
    this.body.hidden = !this.open;
    if (this.open) {
      this.popup.active = true;
      this.popup.reposition();
    }
  }
  hasTrigger(triggerType) {
    const triggers = this.trigger.split(" ");
    return triggers.includes(triggerType);
  }
  async handleOpenChange() {
    var _a, _b;
    if (this.open) {
      if (this.disabled) {
        return;
      }
      this.emit("sl-show");
      if ("CloseWatcher" in window) {
        (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
        this.closeWatcher = new CloseWatcher();
        this.closeWatcher.onclose = () => {
          this.hide();
        };
      } else {
        document.addEventListener("keydown", this.handleDocumentKeyDown);
      }
      await stopAnimations(this.body);
      this.body.hidden = false;
      this.popup.active = true;
      const { keyframes, options } = getAnimation(this, "tooltip.show", { dir: this.localize.dir() });
      await animateTo(this.popup.popup, keyframes, options);
      this.popup.reposition();
      this.emit("sl-after-show");
    } else {
      this.emit("sl-hide");
      (_b = this.closeWatcher) == null ? void 0 : _b.destroy();
      document.removeEventListener("keydown", this.handleDocumentKeyDown);
      await stopAnimations(this.body);
      const { keyframes, options } = getAnimation(this, "tooltip.hide", { dir: this.localize.dir() });
      await animateTo(this.popup.popup, keyframes, options);
      this.popup.active = false;
      this.body.hidden = true;
      this.emit("sl-after-hide");
    }
  }
  async handleOptionsChange() {
    if (this.hasUpdated) {
      await this.updateComplete;
      this.popup.reposition();
    }
  }
  handleDisabledChange() {
    if (this.disabled && this.open) {
      this.hide();
    }
  }
  /** Shows the tooltip. */
  async show() {
    if (this.open) {
      return void 0;
    }
    this.open = true;
    return waitForEvent(this, "sl-after-show");
  }
  /** Hides the tooltip */
  async hide() {
    if (!this.open) {
      return void 0;
    }
    this.open = false;
    return waitForEvent(this, "sl-after-hide");
  }
  //
  // NOTE: Tooltip is a bit unique in that we're using aria-live instead of aria-labelledby to trick screen readers into
  // announcing the content. It works really well, but it violates an accessibility rule. We're also adding the
  // aria-describedby attribute to a slot, which is required by <sl-popup> to correctly locate the first assigned
  // element, otherwise positioning is incorrect.
  //
  render() {
    return b`
      <sl-popup
        part="base"
        exportparts="
          popup:base__popup,
          arrow:base__arrow
        "
        class=${e8({
      tooltip: true,
      "tooltip--open": this.open
    })}
        placement=${this.placement}
        distance=${this.distance}
        skidding=${this.skidding}
        strategy=${this.hoist ? "fixed" : "absolute"}
        flip
        shift
        arrow
        hover-bridge
      >
        ${""}
        <slot slot="anchor" aria-describedby="tooltip"></slot>

        ${""}
        <div part="body" id="tooltip" class="tooltip__body" role="tooltip" aria-live=${this.open ? "polite" : "off"}>
          <slot name="content">${this.content}</slot>
        </div>
      </sl-popup>
    `;
  }
};
SlTooltip.styles = [component_styles_default, tooltip_styles_default];
SlTooltip.dependencies = { "sl-popup": SlPopup };
__decorateClass([
  e7("slot:not([name])")
], SlTooltip.prototype, "defaultSlot", 2);
__decorateClass([
  e7(".tooltip__body")
], SlTooltip.prototype, "body", 2);
__decorateClass([
  e7("sl-popup")
], SlTooltip.prototype, "popup", 2);
__decorateClass([
  n4()
], SlTooltip.prototype, "content", 2);
__decorateClass([
  n4()
], SlTooltip.prototype, "placement", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTooltip.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Number })
], SlTooltip.prototype, "distance", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTooltip.prototype, "open", 2);
__decorateClass([
  n4({ type: Number })
], SlTooltip.prototype, "skidding", 2);
__decorateClass([
  n4()
], SlTooltip.prototype, "trigger", 2);
__decorateClass([
  n4({ type: Boolean })
], SlTooltip.prototype, "hoist", 2);
__decorateClass([
  watch("open", { waitUntilFirstUpdate: true })
], SlTooltip.prototype, "handleOpenChange", 1);
__decorateClass([
  watch(["content", "distance", "hoist", "placement", "skidding"])
], SlTooltip.prototype, "handleOptionsChange", 1);
__decorateClass([
  watch("disabled")
], SlTooltip.prototype, "handleDisabledChange", 1);
setDefaultAnimation("tooltip.show", {
  keyframes: [
    { opacity: 0, scale: 0.8 },
    { opacity: 1, scale: 1 }
  ],
  options: { duration: 150, easing: "ease" }
});
setDefaultAnimation("tooltip.hide", {
  keyframes: [
    { opacity: 1, scale: 1 },
    { opacity: 0, scale: 0.8 }
  ],
  options: { duration: 150, easing: "ease" }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.URTPIBTY.js
SlTooltip.define("sl-tooltip");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.VESXC477.js
function* activeElements(activeElement = document.activeElement) {
  if (activeElement === null || activeElement === void 0) return;
  yield activeElement;
  if ("shadowRoot" in activeElement && activeElement.shadowRoot && activeElement.shadowRoot.mode !== "closed") {
    yield* __yieldStar(activeElements(activeElement.shadowRoot.activeElement));
  }
}
function getDeepestActiveElement() {
  return [...activeElements()].pop();
}
var computedStyleMap = /* @__PURE__ */ new WeakMap();
function getCachedComputedStyle(el) {
  let computedStyle = computedStyleMap.get(el);
  if (!computedStyle) {
    computedStyle = window.getComputedStyle(el, null);
    computedStyleMap.set(el, computedStyle);
  }
  return computedStyle;
}
function isVisible(el) {
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  const computedStyle = getCachedComputedStyle(el);
  return computedStyle.visibility !== "hidden" && computedStyle.display !== "none";
}
function isOverflowingAndTabbable(el) {
  const computedStyle = getCachedComputedStyle(el);
  const { overflowY, overflowX } = computedStyle;
  if (overflowY === "scroll" || overflowX === "scroll") {
    return true;
  }
  if (overflowY !== "auto" || overflowX !== "auto") {
    return false;
  }
  const isOverflowingY = el.scrollHeight > el.clientHeight;
  if (isOverflowingY && overflowY === "auto") {
    return true;
  }
  const isOverflowingX = el.scrollWidth > el.clientWidth;
  if (isOverflowingX && overflowX === "auto") {
    return true;
  }
  return false;
}
function isTabbable(el) {
  const tag = el.tagName.toLowerCase();
  const tabindex = Number(el.getAttribute("tabindex"));
  const hasTabindex = el.hasAttribute("tabindex");
  if (hasTabindex && (isNaN(tabindex) || tabindex <= -1)) {
    return false;
  }
  if (el.hasAttribute("disabled")) {
    return false;
  }
  if (el.closest("[inert]")) {
    return false;
  }
  if (tag === "input" && el.getAttribute("type") === "radio") {
    const rootNode = el.getRootNode();
    const findRadios = `input[type='radio'][name="${el.getAttribute("name")}"]`;
    const firstChecked = rootNode.querySelector(`${findRadios}:checked`);
    if (firstChecked) {
      return firstChecked === el;
    }
    const firstRadio = rootNode.querySelector(findRadios);
    return firstRadio === el;
  }
  if (!isVisible(el)) {
    return false;
  }
  if ((tag === "audio" || tag === "video") && el.hasAttribute("controls")) {
    return true;
  }
  if (el.hasAttribute("tabindex")) {
    return true;
  }
  if (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") {
    return true;
  }
  const isNativelyTabbable = [
    "button",
    "input",
    "select",
    "textarea",
    "a",
    "audio",
    "video",
    "summary",
    "iframe"
  ].includes(tag);
  if (isNativelyTabbable) {
    return true;
  }
  return isOverflowingAndTabbable(el);
}
function getSlottedChildrenOutsideRootElement(slotElement, root) {
  var _a;
  return ((_a = slotElement.getRootNode({ composed: true })) == null ? void 0 : _a.host) !== root;
}
function getTabbableElements(root) {
  const walkedEls = /* @__PURE__ */ new WeakMap();
  const tabbableElements = [];
  function walk(el) {
    if (el instanceof Element) {
      if (el.hasAttribute("inert") || el.closest("[inert]")) {
        return;
      }
      if (walkedEls.has(el)) {
        return;
      }
      walkedEls.set(el, true);
      if (!tabbableElements.includes(el) && isTabbable(el)) {
        tabbableElements.push(el);
      }
      if (el instanceof HTMLSlotElement && getSlottedChildrenOutsideRootElement(el, root)) {
        el.assignedElements({ flatten: true }).forEach((assignedEl) => {
          walk(assignedEl);
        });
      }
      if (el.shadowRoot !== null && el.shadowRoot.mode === "open") {
        walk(el.shadowRoot);
      }
    }
    for (const e10 of el.children) {
      walk(e10);
    }
  }
  walk(root);
  return tabbableElements.sort((a4, b3) => {
    const aTabindex = Number(a4.getAttribute("tabindex")) || 0;
    const bTabindex = Number(b3.getAttribute("tabindex")) || 0;
    return bTabindex - aTabindex;
  });
}

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.EMN3H5QW.js
var activeModals = [];
var Modal = class {
  constructor(element) {
    this.tabDirection = "forward";
    this.handleFocusIn = () => {
      if (!this.isActive()) return;
      this.checkFocus();
    };
    this.handleKeyDown = (event) => {
      var _a;
      if (event.key !== "Tab" || this.isExternalActivated) return;
      if (!this.isActive()) return;
      const currentActiveElement = getDeepestActiveElement();
      this.previousFocus = currentActiveElement;
      if (this.previousFocus && this.possiblyHasTabbableChildren(this.previousFocus)) {
        return;
      }
      if (event.shiftKey) {
        this.tabDirection = "backward";
      } else {
        this.tabDirection = "forward";
      }
      const tabbableElements = getTabbableElements(this.element);
      let currentFocusIndex = tabbableElements.findIndex((el) => el === currentActiveElement);
      this.previousFocus = this.currentFocus;
      const addition = this.tabDirection === "forward" ? 1 : -1;
      while (true) {
        if (currentFocusIndex + addition >= tabbableElements.length) {
          currentFocusIndex = 0;
        } else if (currentFocusIndex + addition < 0) {
          currentFocusIndex = tabbableElements.length - 1;
        } else {
          currentFocusIndex += addition;
        }
        this.previousFocus = this.currentFocus;
        const nextFocus = (
          /** @type {HTMLElement} */
          tabbableElements[currentFocusIndex]
        );
        if (this.tabDirection === "backward") {
          if (this.previousFocus && this.possiblyHasTabbableChildren(this.previousFocus)) {
            return;
          }
        }
        if (nextFocus && this.possiblyHasTabbableChildren(nextFocus)) {
          return;
        }
        event.preventDefault();
        this.currentFocus = nextFocus;
        (_a = this.currentFocus) == null ? void 0 : _a.focus({ preventScroll: false });
        const allActiveElements = [...activeElements()];
        if (allActiveElements.includes(this.currentFocus) || !allActiveElements.includes(this.previousFocus)) {
          break;
        }
      }
      setTimeout(() => this.checkFocus());
    };
    this.handleKeyUp = () => {
      this.tabDirection = "forward";
    };
    this.element = element;
    this.elementsWithTabbableControls = ["iframe"];
  }
  /** Activates focus trapping. */
  activate() {
    activeModals.push(this.element);
    document.addEventListener("focusin", this.handleFocusIn);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
  }
  /** Deactivates focus trapping. */
  deactivate() {
    activeModals = activeModals.filter((modal) => modal !== this.element);
    this.currentFocus = null;
    document.removeEventListener("focusin", this.handleFocusIn);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
  }
  /** Determines if this modal element is currently active or not. */
  isActive() {
    return activeModals[activeModals.length - 1] === this.element;
  }
  /** Activates external modal behavior and temporarily disables focus trapping. */
  activateExternal() {
    this.isExternalActivated = true;
  }
  /** Deactivates external modal behavior and re-enables focus trapping. */
  deactivateExternal() {
    this.isExternalActivated = false;
  }
  checkFocus() {
    if (this.isActive() && !this.isExternalActivated) {
      const tabbableElements = getTabbableElements(this.element);
      if (!this.element.matches(":focus-within")) {
        const start = tabbableElements[0];
        const end = tabbableElements[tabbableElements.length - 1];
        const target = this.tabDirection === "forward" ? start : end;
        if (typeof (target == null ? void 0 : target.focus) === "function") {
          this.currentFocus = target;
          target.focus({ preventScroll: false });
        }
      }
    }
  }
  possiblyHasTabbableChildren(element) {
    return this.elementsWithTabbableControls.includes(element.tagName.toLowerCase()) || element.hasAttribute("controls");
  }
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.G5RKA5HF.js
var dialog_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.LD4M4QGE.js
var blurActiveElement = (elm) => {
  var _a;
  const { activeElement } = document;
  if (activeElement && elm.contains(activeElement)) {
    (_a = document.activeElement) == null ? void 0 : _a.blur();
  }
};

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.NIOQIUH4.js
var SlDialog = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.hasSlotController = new HasSlotController(this, "footer");
    this.localize = new LocalizeController2(this);
    this.modal = new Modal(this);
    this.open = false;
    this.label = "";
    this.noHeader = false;
    this.handleDocumentKeyDown = (event) => {
      if (event.key === "Escape" && this.modal.isActive() && this.open) {
        event.stopPropagation();
        this.requestClose("keyboard");
      }
    };
  }
  firstUpdated() {
    this.dialog.hidden = !this.open;
    if (this.open) {
      this.addOpenListeners();
      this.modal.activate();
      lockBodyScrolling(this);
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.modal.deactivate();
    unlockBodyScrolling(this);
    this.removeOpenListeners();
  }
  requestClose(source) {
    const slRequestClose = this.emit("sl-request-close", {
      cancelable: true,
      detail: { source }
    });
    if (slRequestClose.defaultPrevented) {
      const animation = getAnimation(this, "dialog.denyClose", { dir: this.localize.dir() });
      animateTo(this.panel, animation.keyframes, animation.options);
      return;
    }
    this.hide();
  }
  addOpenListeners() {
    var _a;
    if ("CloseWatcher" in window) {
      (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
      this.closeWatcher = new CloseWatcher();
      this.closeWatcher.onclose = () => this.requestClose("keyboard");
    } else {
      document.addEventListener("keydown", this.handleDocumentKeyDown);
    }
  }
  removeOpenListeners() {
    var _a;
    (_a = this.closeWatcher) == null ? void 0 : _a.destroy();
    document.removeEventListener("keydown", this.handleDocumentKeyDown);
  }
  async handleOpenChange() {
    if (this.open) {
      this.emit("sl-show");
      this.addOpenListeners();
      this.originalTrigger = document.activeElement;
      this.modal.activate();
      lockBodyScrolling(this);
      const autoFocusTarget = this.querySelector("[autofocus]");
      if (autoFocusTarget) {
        autoFocusTarget.removeAttribute("autofocus");
      }
      await Promise.all([stopAnimations(this.dialog), stopAnimations(this.overlay)]);
      this.dialog.hidden = false;
      requestAnimationFrame(() => {
        const slInitialFocus = this.emit("sl-initial-focus", { cancelable: true });
        if (!slInitialFocus.defaultPrevented) {
          if (autoFocusTarget) {
            autoFocusTarget.focus({ preventScroll: true });
          } else {
            this.panel.focus({ preventScroll: true });
          }
        }
        if (autoFocusTarget) {
          autoFocusTarget.setAttribute("autofocus", "");
        }
      });
      const panelAnimation = getAnimation(this, "dialog.show", { dir: this.localize.dir() });
      const overlayAnimation = getAnimation(this, "dialog.overlay.show", { dir: this.localize.dir() });
      await Promise.all([
        animateTo(this.panel, panelAnimation.keyframes, panelAnimation.options),
        animateTo(this.overlay, overlayAnimation.keyframes, overlayAnimation.options)
      ]);
      this.emit("sl-after-show");
    } else {
      blurActiveElement(this);
      this.emit("sl-hide");
      this.removeOpenListeners();
      this.modal.deactivate();
      await Promise.all([stopAnimations(this.dialog), stopAnimations(this.overlay)]);
      const panelAnimation = getAnimation(this, "dialog.hide", { dir: this.localize.dir() });
      const overlayAnimation = getAnimation(this, "dialog.overlay.hide", { dir: this.localize.dir() });
      await Promise.all([
        animateTo(this.overlay, overlayAnimation.keyframes, overlayAnimation.options).then(() => {
          this.overlay.hidden = true;
        }),
        animateTo(this.panel, panelAnimation.keyframes, panelAnimation.options).then(() => {
          this.panel.hidden = true;
        })
      ]);
      this.dialog.hidden = true;
      this.overlay.hidden = false;
      this.panel.hidden = false;
      unlockBodyScrolling(this);
      const trigger = this.originalTrigger;
      if (typeof (trigger == null ? void 0 : trigger.focus) === "function") {
        setTimeout(() => trigger.focus());
      }
      this.emit("sl-after-hide");
    }
  }
  /** Shows the dialog. */
  async show() {
    if (this.open) {
      return void 0;
    }
    this.open = true;
    return waitForEvent(this, "sl-after-show");
  }
  /** Hides the dialog */
  async hide() {
    if (!this.open) {
      return void 0;
    }
    this.open = false;
    return waitForEvent(this, "sl-after-hide");
  }
  render() {
    return b`
      <div
        part="base"
        class=${e8({
      dialog: true,
      "dialog--open": this.open,
      "dialog--has-footer": this.hasSlotController.test("footer")
    })}
      >
        <div part="overlay" class="dialog__overlay" @click=${() => this.requestClose("overlay")} tabindex="-1"></div>

        <div
          part="panel"
          class="dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-hidden=${this.open ? "false" : "true"}
          aria-label=${o9(this.noHeader ? this.label : void 0)}
          aria-labelledby=${o9(!this.noHeader ? "title" : void 0)}
          tabindex="-1"
        >
          ${!this.noHeader ? b`
                <header part="header" class="dialog__header">
                  <h2 part="title" class="dialog__title" id="title">
                    <slot name="label"> ${this.label.length > 0 ? this.label : String.fromCharCode(65279)} </slot>
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
                      @click="${() => this.requestClose("close-button")}"
                    ></sl-icon-button>
                  </div>
                </header>
              ` : ""}
          ${""}
          <div part="body" class="dialog__body" tabindex="-1"><slot></slot></div>

          <footer part="footer" class="dialog__footer">
            <slot name="footer"></slot>
          </footer>
        </div>
      </div>
    `;
  }
};
SlDialog.styles = [component_styles_default, dialog_styles_default];
SlDialog.dependencies = {
  "sl-icon-button": SlIconButton
};
__decorateClass([
  e7(".dialog")
], SlDialog.prototype, "dialog", 2);
__decorateClass([
  e7(".dialog__panel")
], SlDialog.prototype, "panel", 2);
__decorateClass([
  e7(".dialog__overlay")
], SlDialog.prototype, "overlay", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlDialog.prototype, "open", 2);
__decorateClass([
  n4({ reflect: true })
], SlDialog.prototype, "label", 2);
__decorateClass([
  n4({ attribute: "no-header", type: Boolean, reflect: true })
], SlDialog.prototype, "noHeader", 2);
__decorateClass([
  watch("open", { waitUntilFirstUpdate: true })
], SlDialog.prototype, "handleOpenChange", 1);
setDefaultAnimation("dialog.show", {
  keyframes: [
    { opacity: 0, scale: 0.8 },
    { opacity: 1, scale: 1 }
  ],
  options: { duration: 250, easing: "ease" }
});
setDefaultAnimation("dialog.hide", {
  keyframes: [
    { opacity: 1, scale: 1 },
    { opacity: 0, scale: 0.8 }
  ],
  options: { duration: 250, easing: "ease" }
});
setDefaultAnimation("dialog.denyClose", {
  keyframes: [{ scale: 1 }, { scale: 1.02 }, { scale: 1 }],
  options: { duration: 250 }
});
setDefaultAnimation("dialog.overlay.show", {
  keyframes: [{ opacity: 0 }, { opacity: 1 }],
  options: { duration: 250 }
});
setDefaultAnimation("dialog.overlay.hide", {
  keyframes: [{ opacity: 1 }, { opacity: 0 }],
  options: { duration: 250 }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.KPLQLAWP.js
SlDialog.define("sl-dialog");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.XJU7WU2G.js
var tab_group_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.5VKIB4HA.js
var resize_observer_styles_default = i3`
  :host {
    display: contents;
  }
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.GJLC4SWQ.js
var SlResizeObserver = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.observedElements = [];
    this.disabled = false;
  }
  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver((entries) => {
      this.emit("sl-resize", { detail: { entries } });
    });
    if (!this.disabled) {
      this.startObserver();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopObserver();
  }
  handleSlotChange() {
    if (!this.disabled) {
      this.startObserver();
    }
  }
  startObserver() {
    const slot = this.shadowRoot.querySelector("slot");
    if (slot !== null) {
      const elements = slot.assignedElements({ flatten: true });
      this.observedElements.forEach((el) => this.resizeObserver.unobserve(el));
      this.observedElements = [];
      elements.forEach((el) => {
        this.resizeObserver.observe(el);
        this.observedElements.push(el);
      });
    }
  }
  stopObserver() {
    this.resizeObserver.disconnect();
  }
  handleDisabledChange() {
    if (this.disabled) {
      this.stopObserver();
    } else {
      this.startObserver();
    }
  }
  render() {
    return b` <slot @slotchange=${this.handleSlotChange}></slot> `;
  }
};
SlResizeObserver.styles = [component_styles_default, resize_observer_styles_default];
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlResizeObserver.prototype, "disabled", 2);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlResizeObserver.prototype, "handleDisabledChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.UGXNRQQX.js
var SlTabGroup = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.tabs = [];
    this.focusableTabs = [];
    this.panels = [];
    this.localize = new LocalizeController2(this);
    this.hasScrollControls = false;
    this.shouldHideScrollStartButton = false;
    this.shouldHideScrollEndButton = false;
    this.placement = "top";
    this.activation = "auto";
    this.noScrollControls = false;
    this.fixedScrollControls = false;
    this.scrollOffset = 1;
  }
  connectedCallback() {
    const whenAllDefined = Promise.all([
      customElements.whenDefined("sl-tab"),
      customElements.whenDefined("sl-tab-panel")
    ]);
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      this.repositionIndicator();
      this.updateScrollControls();
    });
    this.mutationObserver = new MutationObserver((mutations) => {
      const instanceMutations = mutations.filter(({ target }) => {
        if (target === this) return true;
        if (target.closest("sl-tab-group") !== this) return false;
        const tagName = target.tagName.toLowerCase();
        return tagName === "sl-tab" || tagName === "sl-tab-panel";
      });
      if (instanceMutations.length === 0) {
        return;
      }
      if (instanceMutations.some((m3) => !["aria-labelledby", "aria-controls"].includes(m3.attributeName))) {
        setTimeout(() => this.setAriaLabels());
      }
      if (instanceMutations.some((m3) => m3.attributeName === "disabled")) {
        this.syncTabsAndPanels();
      } else if (instanceMutations.some((m3) => m3.attributeName === "active")) {
        const tabs = instanceMutations.filter((m3) => m3.attributeName === "active" && m3.target.tagName.toLowerCase() === "sl-tab").map((m3) => m3.target);
        const newActiveTab = tabs.find((tab) => tab.active);
        if (newActiveTab) {
          this.setActiveTab(newActiveTab);
        }
      }
    });
    this.updateComplete.then(() => {
      this.syncTabsAndPanels();
      this.mutationObserver.observe(this, {
        attributes: true,
        attributeFilter: ["active", "disabled", "name", "panel"],
        childList: true,
        subtree: true
      });
      this.resizeObserver.observe(this.nav);
      whenAllDefined.then(() => {
        const intersectionObserver = new IntersectionObserver((entries, observer) => {
          var _a;
          if (entries[0].intersectionRatio > 0) {
            this.setAriaLabels();
            this.setActiveTab((_a = this.getActiveTab()) != null ? _a : this.tabs[0], { emitEvents: false });
            observer.unobserve(entries[0].target);
          }
        });
        intersectionObserver.observe(this.tabGroup);
      });
    });
  }
  disconnectedCallback() {
    var _a, _b;
    super.disconnectedCallback();
    (_a = this.mutationObserver) == null ? void 0 : _a.disconnect();
    if (this.nav) {
      (_b = this.resizeObserver) == null ? void 0 : _b.unobserve(this.nav);
    }
  }
  getAllTabs() {
    const slot = this.shadowRoot.querySelector('slot[name="nav"]');
    return slot.assignedElements();
  }
  getAllPanels() {
    return [...this.body.assignedElements()].filter((el) => el.tagName.toLowerCase() === "sl-tab-panel");
  }
  getActiveTab() {
    return this.tabs.find((el) => el.active);
  }
  handleClick(event) {
    const target = event.target;
    const tab = target.closest("sl-tab");
    const tabGroup = tab == null ? void 0 : tab.closest("sl-tab-group");
    if (tabGroup !== this) {
      return;
    }
    if (tab !== null) {
      this.setActiveTab(tab, { scrollBehavior: "smooth" });
    }
  }
  handleKeyDown(event) {
    const target = event.target;
    const tab = target.closest("sl-tab");
    const tabGroup = tab == null ? void 0 : tab.closest("sl-tab-group");
    if (tabGroup !== this) {
      return;
    }
    if (["Enter", " "].includes(event.key)) {
      if (tab !== null) {
        this.setActiveTab(tab, { scrollBehavior: "smooth" });
        event.preventDefault();
      }
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const activeEl = this.tabs.find((t6) => t6.matches(":focus"));
      const isRtl = this.localize.dir() === "rtl";
      let nextTab = null;
      if ((activeEl == null ? void 0 : activeEl.tagName.toLowerCase()) === "sl-tab") {
        if (event.key === "Home") {
          nextTab = this.focusableTabs[0];
        } else if (event.key === "End") {
          nextTab = this.focusableTabs[this.focusableTabs.length - 1];
        } else if (["top", "bottom"].includes(this.placement) && event.key === (isRtl ? "ArrowRight" : "ArrowLeft") || ["start", "end"].includes(this.placement) && event.key === "ArrowUp") {
          const currentIndex = this.tabs.findIndex((el) => el === activeEl);
          nextTab = this.findNextFocusableTab(currentIndex, "backward");
        } else if (["top", "bottom"].includes(this.placement) && event.key === (isRtl ? "ArrowLeft" : "ArrowRight") || ["start", "end"].includes(this.placement) && event.key === "ArrowDown") {
          const currentIndex = this.tabs.findIndex((el) => el === activeEl);
          nextTab = this.findNextFocusableTab(currentIndex, "forward");
        }
        if (!nextTab) {
          return;
        }
        nextTab.tabIndex = 0;
        nextTab.focus({ preventScroll: true });
        if (this.activation === "auto") {
          this.setActiveTab(nextTab, { scrollBehavior: "smooth" });
        } else {
          this.tabs.forEach((tabEl) => {
            tabEl.tabIndex = tabEl === nextTab ? 0 : -1;
          });
        }
        if (["top", "bottom"].includes(this.placement)) {
          scrollIntoView(nextTab, this.nav, "horizontal");
        }
        event.preventDefault();
      }
    }
  }
  handleScrollToStart() {
    this.nav.scroll({
      left: this.localize.dir() === "rtl" ? this.nav.scrollLeft + this.nav.clientWidth : this.nav.scrollLeft - this.nav.clientWidth,
      behavior: "smooth"
    });
  }
  handleScrollToEnd() {
    this.nav.scroll({
      left: this.localize.dir() === "rtl" ? this.nav.scrollLeft - this.nav.clientWidth : this.nav.scrollLeft + this.nav.clientWidth,
      behavior: "smooth"
    });
  }
  setActiveTab(tab, options) {
    options = __spreadValues({
      emitEvents: true,
      scrollBehavior: "auto"
    }, options);
    if (tab !== this.activeTab && !tab.disabled) {
      const previousTab = this.activeTab;
      this.activeTab = tab;
      this.tabs.forEach((el) => {
        el.active = el === this.activeTab;
        el.tabIndex = el === this.activeTab ? 0 : -1;
      });
      this.panels.forEach((el) => {
        var _a;
        return el.active = el.name === ((_a = this.activeTab) == null ? void 0 : _a.panel);
      });
      this.syncIndicator();
      if (["top", "bottom"].includes(this.placement)) {
        scrollIntoView(this.activeTab, this.nav, "horizontal", options.scrollBehavior);
      }
      if (options.emitEvents) {
        if (previousTab) {
          this.emit("sl-tab-hide", { detail: { name: previousTab.panel } });
        }
        this.emit("sl-tab-show", { detail: { name: this.activeTab.panel } });
      }
    }
  }
  setAriaLabels() {
    this.tabs.forEach((tab) => {
      const panel = this.panels.find((el) => el.name === tab.panel);
      if (panel) {
        tab.setAttribute("aria-controls", panel.getAttribute("id"));
        panel.setAttribute("aria-labelledby", tab.getAttribute("id"));
      }
    });
  }
  repositionIndicator() {
    const currentTab = this.getActiveTab();
    if (!currentTab) {
      return;
    }
    const width = currentTab.clientWidth;
    const height = currentTab.clientHeight;
    const isRtl = this.localize.dir() === "rtl";
    const allTabs = this.getAllTabs();
    const precedingTabs = allTabs.slice(0, allTabs.indexOf(currentTab));
    const offset3 = precedingTabs.reduce(
      (previous, current) => ({
        left: previous.left + current.clientWidth,
        top: previous.top + current.clientHeight
      }),
      { left: 0, top: 0 }
    );
    switch (this.placement) {
      case "top":
      case "bottom":
        this.indicator.style.width = `${width}px`;
        this.indicator.style.height = "auto";
        this.indicator.style.translate = isRtl ? `${-1 * offset3.left}px` : `${offset3.left}px`;
        break;
      case "start":
      case "end":
        this.indicator.style.width = "auto";
        this.indicator.style.height = `${height}px`;
        this.indicator.style.translate = `0 ${offset3.top}px`;
        break;
    }
  }
  // This stores tabs and panels so we can refer to a cache instead of calling querySelectorAll() multiple times.
  syncTabsAndPanels() {
    this.tabs = this.getAllTabs();
    this.focusableTabs = this.tabs.filter((el) => !el.disabled);
    this.panels = this.getAllPanels();
    this.syncIndicator();
    this.updateComplete.then(() => this.updateScrollControls());
  }
  findNextFocusableTab(currentIndex, direction) {
    let nextTab = null;
    const iterator = direction === "forward" ? 1 : -1;
    let nextIndex = currentIndex + iterator;
    while (currentIndex < this.tabs.length) {
      nextTab = this.tabs[nextIndex] || null;
      if (nextTab === null) {
        if (direction === "forward") {
          nextTab = this.focusableTabs[0];
        } else {
          nextTab = this.focusableTabs[this.focusableTabs.length - 1];
        }
        break;
      }
      if (!nextTab.disabled) {
        break;
      }
      nextIndex += iterator;
    }
    return nextTab;
  }
  updateScrollButtons() {
    if (this.hasScrollControls && !this.fixedScrollControls) {
      this.shouldHideScrollStartButton = this.scrollFromStart() <= this.scrollOffset;
      this.shouldHideScrollEndButton = this.isScrolledToEnd();
    }
  }
  isScrolledToEnd() {
    return this.scrollFromStart() + this.nav.clientWidth >= this.nav.scrollWidth - this.scrollOffset;
  }
  scrollFromStart() {
    return this.localize.dir() === "rtl" ? -this.nav.scrollLeft : this.nav.scrollLeft;
  }
  updateScrollControls() {
    if (this.noScrollControls) {
      this.hasScrollControls = false;
    } else {
      this.hasScrollControls = ["top", "bottom"].includes(this.placement) && this.nav.scrollWidth > this.nav.clientWidth + 1;
    }
    this.updateScrollButtons();
  }
  syncIndicator() {
    const tab = this.getActiveTab();
    if (tab) {
      this.indicator.style.display = "block";
      this.repositionIndicator();
    } else {
      this.indicator.style.display = "none";
    }
  }
  /** Shows the specified tab panel. */
  show(panel) {
    const tab = this.tabs.find((el) => el.panel === panel);
    if (tab) {
      this.setActiveTab(tab, { scrollBehavior: "smooth" });
    }
  }
  render() {
    const isRtl = this.localize.dir() === "rtl";
    return b`
      <div
        part="base"
        class=${e8({
      "tab-group": true,
      "tab-group--top": this.placement === "top",
      "tab-group--bottom": this.placement === "bottom",
      "tab-group--start": this.placement === "start",
      "tab-group--end": this.placement === "end",
      "tab-group--rtl": this.localize.dir() === "rtl",
      "tab-group--has-scroll-controls": this.hasScrollControls
    })}
        @click=${this.handleClick}
        @keydown=${this.handleKeyDown}
      >
        <div class="tab-group__nav-container" part="nav">
          ${this.hasScrollControls ? b`
                <sl-icon-button
                  part="scroll-button scroll-button--start"
                  exportparts="base:scroll-button__base"
                  class=${e8({
      "tab-group__scroll-button": true,
      "tab-group__scroll-button--start": true,
      "tab-group__scroll-button--start--hidden": this.shouldHideScrollStartButton
    })}
                  name=${isRtl ? "chevron-right" : "chevron-left"}
                  library="system"
                  tabindex="-1"
                  aria-hidden="true"
                  label=${this.localize.term("scrollToStart")}
                  @click=${this.handleScrollToStart}
                ></sl-icon-button>
              ` : ""}

          <div class="tab-group__nav" @scrollend=${this.updateScrollButtons}>
            <div part="tabs" class="tab-group__tabs" role="tablist">
              <div part="active-tab-indicator" class="tab-group__indicator"></div>
              <sl-resize-observer @sl-resize=${this.syncIndicator}>
                <slot name="nav" @slotchange=${this.syncTabsAndPanels}></slot>
              </sl-resize-observer>
            </div>
          </div>

          ${this.hasScrollControls ? b`
                <sl-icon-button
                  part="scroll-button scroll-button--end"
                  exportparts="base:scroll-button__base"
                  class=${e8({
      "tab-group__scroll-button": true,
      "tab-group__scroll-button--end": true,
      "tab-group__scroll-button--end--hidden": this.shouldHideScrollEndButton
    })}
                  name=${isRtl ? "chevron-left" : "chevron-right"}
                  library="system"
                  tabindex="-1"
                  aria-hidden="true"
                  label=${this.localize.term("scrollToEnd")}
                  @click=${this.handleScrollToEnd}
                ></sl-icon-button>
              ` : ""}
        </div>

        <slot part="body" class="tab-group__body" @slotchange=${this.syncTabsAndPanels}></slot>
      </div>
    `;
  }
};
SlTabGroup.styles = [component_styles_default, tab_group_styles_default];
SlTabGroup.dependencies = { "sl-icon-button": SlIconButton, "sl-resize-observer": SlResizeObserver };
__decorateClass([
  e7(".tab-group")
], SlTabGroup.prototype, "tabGroup", 2);
__decorateClass([
  e7(".tab-group__body")
], SlTabGroup.prototype, "body", 2);
__decorateClass([
  e7(".tab-group__nav")
], SlTabGroup.prototype, "nav", 2);
__decorateClass([
  e7(".tab-group__indicator")
], SlTabGroup.prototype, "indicator", 2);
__decorateClass([
  r8()
], SlTabGroup.prototype, "hasScrollControls", 2);
__decorateClass([
  r8()
], SlTabGroup.prototype, "shouldHideScrollStartButton", 2);
__decorateClass([
  r8()
], SlTabGroup.prototype, "shouldHideScrollEndButton", 2);
__decorateClass([
  n4()
], SlTabGroup.prototype, "placement", 2);
__decorateClass([
  n4()
], SlTabGroup.prototype, "activation", 2);
__decorateClass([
  n4({ attribute: "no-scroll-controls", type: Boolean })
], SlTabGroup.prototype, "noScrollControls", 2);
__decorateClass([
  n4({ attribute: "fixed-scroll-controls", type: Boolean })
], SlTabGroup.prototype, "fixedScrollControls", 2);
__decorateClass([
  t4({ passive: true })
], SlTabGroup.prototype, "updateScrollButtons", 1);
__decorateClass([
  watch("noScrollControls", { waitUntilFirstUpdate: true })
], SlTabGroup.prototype, "updateScrollControls", 1);
__decorateClass([
  watch("placement", { waitUntilFirstUpdate: true })
], SlTabGroup.prototype, "syncIndicator", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.CSI2TGZS.js
SlTabGroup.define("sl-tab-group");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.ZH2AND3P.js
var debounce = (fn, delay) => {
  let timerId = 0;
  return function(...args) {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(() => {
      fn.call(this, ...args);
    }, delay);
  };
};
var decorate = (proto, method, decorateFn) => {
  const superFn = proto[method];
  proto[method] = function(...args) {
    superFn.call(this, ...args);
    decorateFn.call(this, superFn, ...args);
  };
};
(() => {
  if (typeof window === "undefined") {
    return;
  }
  const isSupported = "onscrollend" in window;
  if (!isSupported) {
    const pointers = /* @__PURE__ */ new Set();
    const scrollHandlers = /* @__PURE__ */ new WeakMap();
    const handlePointerDown = (event) => {
      for (const touch of event.changedTouches) {
        pointers.add(touch.identifier);
      }
    };
    const handlePointerUp = (event) => {
      for (const touch of event.changedTouches) {
        pointers.delete(touch.identifier);
      }
    };
    document.addEventListener("touchstart", handlePointerDown, true);
    document.addEventListener("touchend", handlePointerUp, true);
    document.addEventListener("touchcancel", handlePointerUp, true);
    decorate(EventTarget.prototype, "addEventListener", function(addEventListener, type) {
      if (type !== "scrollend") return;
      const handleScrollEnd = debounce(() => {
        if (!pointers.size) {
          this.dispatchEvent(new Event("scrollend"));
        } else {
          handleScrollEnd();
        }
      }, 100);
      addEventListener.call(this, "scroll", handleScrollEnd, { passive: true });
      scrollHandlers.set(this, handleScrollEnd);
    });
    decorate(EventTarget.prototype, "removeEventListener", function(removeEventListener, type) {
      if (type !== "scrollend") return;
      const scrollHandler = scrollHandlers.get(this);
      if (scrollHandler) {
        removeEventListener.call(this, "scroll", scrollHandler, { passive: true });
      }
    });
  }
})();

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.CNMNUZLG.js
var tab_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.YKCGBUWI.js
var id = 0;
var SlTab = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.localize = new LocalizeController2(this);
    this.attrId = ++id;
    this.componentId = `sl-tab-${this.attrId}`;
    this.panel = "";
    this.active = false;
    this.closable = false;
    this.disabled = false;
    this.tabIndex = 0;
  }
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "tab");
  }
  handleCloseClick(event) {
    event.stopPropagation();
    this.emit("sl-close");
  }
  handleActiveChange() {
    this.setAttribute("aria-selected", this.active ? "true" : "false");
  }
  handleDisabledChange() {
    this.setAttribute("aria-disabled", this.disabled ? "true" : "false");
    if (this.disabled && !this.active) {
      this.tabIndex = -1;
    } else {
      this.tabIndex = 0;
    }
  }
  render() {
    this.id = this.id.length > 0 ? this.id : this.componentId;
    return b`
      <div
        part="base"
        class=${e8({
      tab: true,
      "tab--active": this.active,
      "tab--closable": this.closable,
      "tab--disabled": this.disabled
    })}
      >
        <slot></slot>
        ${this.closable ? b`
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
            ` : ""}
      </div>
    `;
  }
};
SlTab.styles = [component_styles_default, tab_styles_default];
SlTab.dependencies = { "sl-icon-button": SlIconButton };
__decorateClass([
  e7(".tab")
], SlTab.prototype, "tab", 2);
__decorateClass([
  n4({ reflect: true })
], SlTab.prototype, "panel", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTab.prototype, "active", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTab.prototype, "closable", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTab.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Number, reflect: true })
], SlTab.prototype, "tabIndex", 2);
__decorateClass([
  watch("active")
], SlTab.prototype, "handleActiveChange", 1);
__decorateClass([
  watch("disabled")
], SlTab.prototype, "handleDisabledChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.DFHYNK3F.js
SlTab.define("sl-tab");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.BQSEJD7X.js
var tab_panel_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.ISIAP7VK.js
var id2 = 0;
var SlTabPanel = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.attrId = ++id2;
    this.componentId = `sl-tab-panel-${this.attrId}`;
    this.name = "";
    this.active = false;
  }
  connectedCallback() {
    super.connectedCallback();
    this.id = this.id.length > 0 ? this.id : this.componentId;
    this.setAttribute("role", "tabpanel");
  }
  handleActiveChange() {
    this.setAttribute("aria-hidden", this.active ? "false" : "true");
  }
  render() {
    return b`
      <slot
        part="base"
        class=${e8({
      "tab-panel": true,
      "tab-panel--active": this.active
    })}
      ></slot>
    `;
  }
};
SlTabPanel.styles = [component_styles_default, tab_panel_styles_default];
__decorateClass([
  n4({ reflect: true })
], SlTabPanel.prototype, "name", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlTabPanel.prototype, "active", 2);
__decorateClass([
  watch("active")
], SlTabPanel.prototype, "handleActiveChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.RY756JLP.js
SlTabPanel.define("sl-tab-panel");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.EU44RQUN.js
var switch_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.TSAI7XEG.js
var SlSwitch = class extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.formControlController = new FormControlController(this, {
      value: (control) => control.checked ? control.value || "on" : void 0,
      defaultValue: (control) => control.defaultChecked,
      setValue: (control, checked) => control.checked = checked
    });
    this.hasSlotController = new HasSlotController(this, "help-text");
    this.hasFocus = false;
    this.title = "";
    this.name = "";
    this.size = "medium";
    this.disabled = false;
    this.checked = false;
    this.defaultChecked = false;
    this.form = "";
    this.required = false;
    this.helpText = "";
  }
  /** Gets the validity state object */
  get validity() {
    return this.input.validity;
  }
  /** Gets the validation message */
  get validationMessage() {
    return this.input.validationMessage;
  }
  firstUpdated() {
    this.formControlController.updateValidity();
  }
  handleBlur() {
    this.hasFocus = false;
    this.emit("sl-blur");
  }
  handleInput() {
    this.emit("sl-input");
  }
  handleInvalid(event) {
    this.formControlController.setValidity(false);
    this.formControlController.emitInvalidEvent(event);
  }
  handleClick() {
    this.checked = !this.checked;
    this.emit("sl-change");
  }
  handleFocus() {
    this.hasFocus = true;
    this.emit("sl-focus");
  }
  handleKeyDown(event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.checked = false;
      this.emit("sl-change");
      this.emit("sl-input");
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.checked = true;
      this.emit("sl-change");
      this.emit("sl-input");
    }
  }
  handleCheckedChange() {
    this.input.checked = this.checked;
    this.formControlController.updateValidity();
  }
  handleDisabledChange() {
    this.formControlController.setValidity(true);
  }
  /** Simulates a click on the switch. */
  click() {
    this.input.click();
  }
  /** Sets focus on the switch. */
  focus(options) {
    this.input.focus(options);
  }
  /** Removes focus from the switch. */
  blur() {
    this.input.blur();
  }
  /** Checks for validity but does not show a validation message. Returns `true` when valid and `false` when invalid. */
  checkValidity() {
    return this.input.checkValidity();
  }
  /** Gets the associated form, if one exists. */
  getForm() {
    return this.formControlController.getForm();
  }
  /** Checks for validity and shows the browser's validation message if the control is invalid. */
  reportValidity() {
    return this.input.reportValidity();
  }
  /** Sets a custom validation message. Pass an empty string to restore validity. */
  setCustomValidity(message) {
    this.input.setCustomValidity(message);
    this.formControlController.updateValidity();
  }
  render() {
    const hasHelpTextSlot = this.hasSlotController.test("help-text");
    const hasHelpText = this.helpText ? true : !!hasHelpTextSlot;
    return b`
      <div
        class=${e8({
      "form-control": true,
      "form-control--small": this.size === "small",
      "form-control--medium": this.size === "medium",
      "form-control--large": this.size === "large",
      "form-control--has-help-text": hasHelpText
    })}
      >
        <label
          part="base"
          class=${e8({
      switch: true,
      "switch--checked": this.checked,
      "switch--disabled": this.disabled,
      "switch--focused": this.hasFocus,
      "switch--small": this.size === "small",
      "switch--medium": this.size === "medium",
      "switch--large": this.size === "large"
    })}
        >
          <input
            class="switch__input"
            type="checkbox"
            title=${this.title}
            name=${this.name}
            value=${o9(this.value)}
            .checked=${l5(this.checked)}
            .disabled=${this.disabled}
            .required=${this.required}
            role="switch"
            aria-checked=${this.checked ? "true" : "false"}
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
          aria-hidden=${hasHelpText ? "false" : "true"}
          class="form-control__help-text"
          id="help-text"
          part="form-control-help-text"
        >
          <slot name="help-text">${this.helpText}</slot>
        </div>
      </div>
    `;
  }
};
SlSwitch.styles = [component_styles_default, form_control_styles_default, switch_styles_default];
__decorateClass([
  e7('input[type="checkbox"]')
], SlSwitch.prototype, "input", 2);
__decorateClass([
  r8()
], SlSwitch.prototype, "hasFocus", 2);
__decorateClass([
  n4()
], SlSwitch.prototype, "title", 2);
__decorateClass([
  n4()
], SlSwitch.prototype, "name", 2);
__decorateClass([
  n4()
], SlSwitch.prototype, "value", 2);
__decorateClass([
  n4({ reflect: true })
], SlSwitch.prototype, "size", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSwitch.prototype, "disabled", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSwitch.prototype, "checked", 2);
__decorateClass([
  defaultValue("checked")
], SlSwitch.prototype, "defaultChecked", 2);
__decorateClass([
  n4({ reflect: true })
], SlSwitch.prototype, "form", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], SlSwitch.prototype, "required", 2);
__decorateClass([
  n4({ attribute: "help-text" })
], SlSwitch.prototype, "helpText", 2);
__decorateClass([
  watch("checked", { waitUntilFirstUpdate: true })
], SlSwitch.prototype, "handleCheckedChange", 1);
__decorateClass([
  watch("disabled", { waitUntilFirstUpdate: true })
], SlSwitch.prototype, "handleDisabledChange", 1);

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.IADS735N.js
SlSwitch.define("sl-switch");

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.HPCLRZ2S.js
var alert_styles_default = i3`
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
`;

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.6UPB6RWT.js
var _SlAlert = class _SlAlert2 extends ShoelaceElement {
  constructor() {
    super(...arguments);
    this.hasSlotController = new HasSlotController(this, "icon", "suffix");
    this.localize = new LocalizeController2(this);
    this.open = false;
    this.closable = false;
    this.variant = "primary";
    this.duration = Infinity;
    this.remainingTime = this.duration;
  }
  static get toastStack() {
    if (!this.currentToastStack) {
      this.currentToastStack = Object.assign(document.createElement("div"), {
        className: "sl-toast-stack"
      });
    }
    return this.currentToastStack;
  }
  firstUpdated() {
    this.base.hidden = !this.open;
  }
  restartAutoHide() {
    this.handleCountdownChange();
    clearTimeout(this.autoHideTimeout);
    clearInterval(this.remainingTimeInterval);
    if (this.open && this.duration < Infinity) {
      this.autoHideTimeout = window.setTimeout(() => this.hide(), this.duration);
      this.remainingTime = this.duration;
      this.remainingTimeInterval = window.setInterval(() => {
        this.remainingTime -= 100;
      }, 100);
    }
  }
  pauseAutoHide() {
    var _a;
    (_a = this.countdownAnimation) == null ? void 0 : _a.pause();
    clearTimeout(this.autoHideTimeout);
    clearInterval(this.remainingTimeInterval);
  }
  resumeAutoHide() {
    var _a;
    if (this.duration < Infinity) {
      this.autoHideTimeout = window.setTimeout(() => this.hide(), this.remainingTime);
      this.remainingTimeInterval = window.setInterval(() => {
        this.remainingTime -= 100;
      }, 100);
      (_a = this.countdownAnimation) == null ? void 0 : _a.play();
    }
  }
  handleCountdownChange() {
    if (this.open && this.duration < Infinity && this.countdown) {
      const { countdownElement } = this;
      const start = "100%";
      const end = "0";
      this.countdownAnimation = countdownElement.animate([{ width: start }, { width: end }], {
        duration: this.duration,
        easing: "linear"
      });
    }
  }
  handleCloseClick() {
    this.hide();
  }
  async handleOpenChange() {
    if (this.open) {
      this.emit("sl-show");
      if (this.duration < Infinity) {
        this.restartAutoHide();
      }
      await stopAnimations(this.base);
      this.base.hidden = false;
      const { keyframes, options } = getAnimation(this, "alert.show", { dir: this.localize.dir() });
      await animateTo(this.base, keyframes, options);
      this.emit("sl-after-show");
    } else {
      blurActiveElement(this);
      this.emit("sl-hide");
      clearTimeout(this.autoHideTimeout);
      clearInterval(this.remainingTimeInterval);
      await stopAnimations(this.base);
      const { keyframes, options } = getAnimation(this, "alert.hide", { dir: this.localize.dir() });
      await animateTo(this.base, keyframes, options);
      this.base.hidden = true;
      this.emit("sl-after-hide");
    }
  }
  handleDurationChange() {
    this.restartAutoHide();
  }
  /** Shows the alert. */
  async show() {
    if (this.open) {
      return void 0;
    }
    this.open = true;
    return waitForEvent(this, "sl-after-show");
  }
  /** Hides the alert */
  async hide() {
    if (!this.open) {
      return void 0;
    }
    this.open = false;
    return waitForEvent(this, "sl-after-hide");
  }
  /**
   * Displays the alert as a toast notification. This will move the alert out of its position in the DOM and, when
   * dismissed, it will be removed from the DOM completely. By storing a reference to the alert, you can reuse it by
   * calling this method again. The returned promise will resolve after the alert is hidden.
   */
  async toast() {
    return new Promise((resolve) => {
      this.handleCountdownChange();
      if (_SlAlert2.toastStack.parentElement === null) {
        document.body.append(_SlAlert2.toastStack);
      }
      _SlAlert2.toastStack.appendChild(this);
      requestAnimationFrame(() => {
        this.clientWidth;
        this.show();
      });
      this.addEventListener(
        "sl-after-hide",
        () => {
          _SlAlert2.toastStack.removeChild(this);
          resolve();
          if (_SlAlert2.toastStack.querySelector("sl-alert") === null) {
            _SlAlert2.toastStack.remove();
          }
        },
        { once: true }
      );
    });
  }
  render() {
    return b`
      <div
        part="base"
        class=${e8({
      alert: true,
      "alert--open": this.open,
      "alert--closable": this.closable,
      "alert--has-countdown": !!this.countdown,
      "alert--has-icon": this.hasSlotController.test("icon"),
      "alert--primary": this.variant === "primary",
      "alert--success": this.variant === "success",
      "alert--neutral": this.variant === "neutral",
      "alert--warning": this.variant === "warning",
      "alert--danger": this.variant === "danger"
    })}
        role="alert"
        aria-hidden=${this.open ? "false" : "true"}
        @mouseenter=${this.pauseAutoHide}
        @mouseleave=${this.resumeAutoHide}
      >
        <div part="icon" class="alert__icon">
          <slot name="icon"></slot>
        </div>

        <div part="message" class="alert__message" aria-live="polite">
          <slot></slot>
        </div>

        ${this.closable ? b`
              <sl-icon-button
                part="close-button"
                exportparts="base:close-button__base"
                class="alert__close-button"
                name="x-lg"
                library="system"
                label=${this.localize.term("close")}
                @click=${this.handleCloseClick}
              ></sl-icon-button>
            ` : ""}

        <div role="timer" class="alert__timer">${this.remainingTime}</div>

        ${this.countdown ? b`
              <div
                class=${e8({
      alert__countdown: true,
      "alert__countdown--ltr": this.countdown === "ltr"
    })}
              >
                <div class="alert__countdown-elapsed"></div>
              </div>
            ` : ""}
      </div>
    `;
  }
};
_SlAlert.styles = [component_styles_default, alert_styles_default];
_SlAlert.dependencies = { "sl-icon-button": SlIconButton };
__decorateClass([
  e7('[part~="base"]')
], _SlAlert.prototype, "base", 2);
__decorateClass([
  e7(".alert__countdown-elapsed")
], _SlAlert.prototype, "countdownElement", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], _SlAlert.prototype, "open", 2);
__decorateClass([
  n4({ type: Boolean, reflect: true })
], _SlAlert.prototype, "closable", 2);
__decorateClass([
  n4({ reflect: true })
], _SlAlert.prototype, "variant", 2);
__decorateClass([
  n4({ type: Number })
], _SlAlert.prototype, "duration", 2);
__decorateClass([
  n4({ type: String, reflect: true })
], _SlAlert.prototype, "countdown", 2);
__decorateClass([
  r8()
], _SlAlert.prototype, "remainingTime", 2);
__decorateClass([
  watch("open", { waitUntilFirstUpdate: true })
], _SlAlert.prototype, "handleOpenChange", 1);
__decorateClass([
  watch("duration")
], _SlAlert.prototype, "handleDurationChange", 1);
var SlAlert = _SlAlert;
setDefaultAnimation("alert.show", {
  keyframes: [
    { opacity: 0, scale: 0.8 },
    { opacity: 1, scale: 1 }
  ],
  options: { duration: 250, easing: "ease" }
});
setDefaultAnimation("alert.hide", {
  keyframes: [
    { opacity: 1, scale: 1 },
    { opacity: 0, scale: 0.8 }
  ],
  options: { duration: 250, easing: "ease" }
});

// node_modules/@shoelace-style/shoelace/dist/chunks/chunk.R45OWEVP.js
SlAlert.define("sl-alert");

// app/main.js
var store = createStore();
var ws = createWsClient();
var route = parseHash(location.hash);
var connectionState = ws.getState();
var autoScroll = true;
var logFilter = "*";
var logSearch = "";
var settings = {};
var logIterationFilter = null;
var pipelineAction = null;
var actionError = null;
ws.on("runs-list", (payload) => {
  const runs = {};
  for (const run of payload.runs || []) {
    runs[run.id] = run;
  }
  store.setState({ runs });
  if (payload.settings) settings = payload.settings;
});
ws.on("run-snapshot", (payload) => {
  if (payload && payload.id) {
    store.setRun(payload.id, payload);
    if (pipelineAction) {
      pipelineAction = null;
      rerender();
    }
  }
});
ws.on("run-update", (payload) => {
  if (payload && payload.id) {
    store.setRun(payload.id, payload);
    if (pipelineAction) {
      pipelineAction = null;
      rerender();
    }
  }
});
ws.on("log-line", (payload) => {
  if (payload) {
    store.appendLog(payload);
    if (payload.iteration && payload.iteration > 1 && payload._iterStart) {
      writeIterationSeparator(payload.iteration);
    }
    writeLogLine(payload);
  }
});
ws.on("log-bulk", (payload) => {
  if (payload && Array.isArray(payload.lines)) {
    for (const line of payload.lines) {
      const entry = { stage: payload.stage, line };
      store.appendLog(entry);
      writeLogLine(entry);
    }
  }
});
ws.on("preferences", (payload) => {
  if (payload) {
    store.setState({ preferences: payload });
    applyTheme(payload.theme || "light");
  }
});
ws.onConnection((state) => {
  connectionState = state;
  if (state === "open") {
    ws.send("list-runs").then((payload) => {
      const runs = {};
      for (const run of payload.runs || []) {
        runs[run.id] = run;
      }
      store.setState({ runs });
      if (payload.settings) settings = payload.settings;
    }).catch(() => {
    });
    ws.send("get-preferences").then((prefs) => {
      store.setState({ preferences: prefs });
      applyTheme(prefs.theme || "light");
    }).catch(() => {
    });
    if (route.runId) {
      ws.send("subscribe-run", { runId: route.runId }).catch(() => {
      });
      ws.send("subscribe-log", { stage: logFilter === "*" ? null : logFilter, runId: route.runId }).catch(() => {
      });
    }
  }
  rerender();
});
onHashChange((newRoute) => {
  const prevRunId = route.runId;
  route = newRoute;
  if (prevRunId && prevRunId !== route.runId) {
    ws.send("unsubscribe-run").catch(() => {
    });
    ws.send("unsubscribe-log").catch(() => {
    });
    store.clearLog();
    clearTerminal();
  }
  if (route.runId && route.runId !== prevRunId) {
    ws.send("subscribe-run", { runId: route.runId }).catch(() => {
    });
    ws.send("subscribe-log", { stage: null, runId: route.runId }).catch(() => {
    });
  }
  if (route.section === "settings") {
    loadSettings().then(() => rerender());
  }
  if (!route.runId && prevRunId) {
    disposeTerminal();
  }
  rerender();
});
function handleNavigate(section) {
  navigate(section, null);
}
function handleSelectRun(runId) {
  navigate(route.section, runId);
}
function handleThemeToggle() {
  const current = store.getState().preferences.theme;
  const next = current === "dark" ? "light" : "dark";
  ws.send("set-preferences", { theme: next }).catch(() => {
  });
  store.setState({ preferences: { theme: next } });
  applyTheme(next);
}
function handleStageFilter(stage) {
  logFilter = stage;
  logIterationFilter = null;
  clearTerminal();
  store.clearLog();
  ws.send("unsubscribe-log").catch(() => {
  });
  ws.send("subscribe-log", { stage: stage === "*" ? null : stage, runId: route.runId }).catch(() => {
  });
  rerender();
}
function handleIterationFilter(iteration) {
  logIterationFilter = iteration;
  clearTerminal();
  store.clearLog();
  ws.send("unsubscribe-log").catch(() => {
  });
  ws.send("subscribe-log", {
    stage: logFilter === "*" ? null : logFilter,
    runId: route.runId,
    iteration
  }).catch(() => {
  });
  rerender();
}
function handleSearch(term) {
  logSearch = term;
  searchTerminal(term);
}
function handleToggleAutoScroll() {
  autoScroll = !autoScroll;
  rerender();
}
function showActionError(msg) {
  actionError = msg;
  rerender();
  requestAnimationFrame(() => {
    const dialog = document.getElementById("action-error-dialog");
    if (dialog) dialog.show();
  });
}
function dismissActionError() {
  actionError = null;
  rerender();
}
function handleStopPipeline() {
  pipelineAction = "stopping";
  actionError = null;
  rerender();
  ws.send("stop-run").then(() => {
  }).catch((err) => {
    pipelineAction = null;
    showActionError(err?.message || "Failed to stop pipeline");
  });
}
function handleResumePipeline() {
  pipelineAction = "resuming";
  actionError = null;
  rerender();
  ws.send("resume-run").then(() => {
  }).catch((err) => {
    pipelineAction = null;
    showActionError(err?.message || "Failed to resume pipeline");
  });
}
function handleBack() {
  if (route.runId) {
    const runs = Object.values(store.getState().runs);
    const activeRuns = runs.filter((r11) => r11.active);
    if (route.section === "active" && activeRuns.length <= 1) {
      navigate("dashboard", null);
    } else {
      navigate(route.section, null);
    }
  } else if (route.section && route.section !== "dashboard") {
    navigate("dashboard", null);
  }
}
function contentHeaderView() {
  const state = store.getState();
  let title = "Dashboard";
  let showBack = false;
  let badge = null;
  let actionButton = null;
  if (route.runId) {
    const run = state.runs[route.runId];
    const raw = run?.work_request?.title || "Pipeline Details";
    const firstLine = raw.split("\n")[0];
    title = firstLine.length > 80 ? firstLine.slice(0, 80) + "\u2026" : firstLine;
    showBack = true;
    if (run) {
      const rs = run.runState || (run.active ? "running" : "terminal");
      const variant = rs === "running" ? "warning" : rs === "interrupted" ? "neutral" : "success";
      const status = rs === "running" ? "in_progress" : rs === "interrupted" ? "interrupted" : "completed";
      const label = rs === "running" ? "Running" : rs === "interrupted" ? "Interrupted" : "Completed";
      badge = b`<sl-badge variant="${variant}" pill>
        ${o2(statusIcon(status, 12))}
        ${label}
      </sl-badge>`;
      if (pipelineAction === "stopping") {
        actionButton = b`
          <button class="action-btn action-btn--danger" disabled>
            ${o2(iconSvg(Loader, 14, "icon-spin"))}
            Stopping\u2026
          </button>`;
      } else if (pipelineAction === "resuming") {
        actionButton = b`
          <button class="action-btn action-btn--primary" disabled>
            ${o2(iconSvg(Loader, 14, "icon-spin"))}
            Resuming\u2026
          </button>`;
      } else if (rs === "running") {
        actionButton = b`
          <button class="action-btn action-btn--danger" @click=${handleStopPipeline}>
            ${o2(iconSvg(Square, 14))}
            Stop Pipeline
          </button>`;
      } else if (rs === "interrupted") {
        actionButton = b`
          <button class="action-btn action-btn--primary" @click=${handleResumePipeline}>
            ${o2(iconSvg(Play, 14))}
            Resume Pipeline
          </button>`;
      }
    }
  } else if (route.section === "active") {
    title = "Running Pipelines";
    showBack = true;
  } else if (route.section === "history") {
    title = "History";
    showBack = true;
  } else if (route.section === "settings") {
    title = "Settings";
    showBack = true;
  }
  return b`
    <div class="content-header">
      ${showBack ? b`
        <button class="content-header-back" @click=${handleBack}>
          ${o2(iconSvg(ArrowLeft, 18))}
        </button>
      ` : ""}
      ${badge || ""}
      <h1 class="content-header-title">${title}</h1>
      ${actionButton ? b`<div class="content-header-actions">
        ${actionButton}
      </div>` : ""}
    </div>
  `;
}
function mainContentView() {
  const state = store.getState();
  const runs = Object.values(state.runs);
  if (route.runId) {
    const run = state.runs[route.runId];
    const stageIterations = {};
    if (run?.stages) {
      for (const [key, stage] of Object.entries(run.stages)) {
        const iters = stage.iterations || [];
        if (iters.length > 0) stageIterations[key] = iters.length;
      }
    }
    const logState = filteredLogState(state);
    logState.currentLogStage = logFilter === "*" ? null : logFilter;
    return b`
      ${runDetailView(run, settings)}
      ${logViewerView(logState, {
      onStageFilter: handleStageFilter,
      onIterationFilter: handleIterationFilter,
      onSearch: handleSearch,
      onToggleAutoScroll: handleToggleAutoScroll,
      autoScroll,
      stageIterations,
      runStages: run?.stages
    })}
    `;
  }
  if (route.section === "settings") {
    return settingsView(state.preferences, { rerender, onThemeToggle: handleThemeToggle });
  }
  if (route.section === "history") {
    return runListView(runs, "history", { onSelectRun: handleSelectRun });
  }
  if (route.section === "active") {
    const activeRuns = runs.filter((r11) => r11.active);
    if (activeRuns.length === 1) {
      navigate("active", activeRuns[0].id);
      return b``;
    }
    return runListView(runs, "active", { onSelectRun: handleSelectRun });
  }
  return dashboardView(state, { onSelectRun: (runId) => navigate("active", runId) });
}
function filteredLogState(state) {
  let lines = state.logLines;
  if (logFilter !== "*") {
    lines = lines.filter((l6) => l6.stage === logFilter);
  }
  if (logSearch) {
    const term = logSearch.toLowerCase();
    lines = lines.filter((l6) => (l6.line || "").toLowerCase().includes(term));
  }
  return { ...state, logLines: lines };
}
function rerender() {
  const state = store.getState();
  const appEl = document.getElementById("app");
  if (!appEl) return;
  D(b`
    <div class="app-shell">
      ${sidebarView(state, route, connectionState, {
    onNavigate: handleNavigate
  })}
      <main class="main-content">
        ${contentHeaderView()}
        ${mainContentView()}
      </main>
    </div>
    ${actionError ? b`
      <sl-dialog id="action-error-dialog" label="Pipeline Error" @sl-after-hide=${dismissActionError}>
        <div class="error-dialog-body">
          ${o2(iconSvg(TriangleAlert, 32, "error-dialog-icon"))}
          <p>${actionError}</p>
        </div>
        <sl-button slot="footer" variant="primary" @click=${() => {
    document.getElementById("action-error-dialog")?.hide();
  }}>OK</sl-button>
      </sl-dialog>
    ` : ""}
  `, appEl);
  if (route.runId) {
    mountTerminal(route.runId);
  }
}
store.subscribe(() => rerender());
applyTheme(store.getState().preferences.theme);
if (route.section === "settings") {
  loadSettings().then(() => rerender());
}
rerender();
/*! Bundled license information:

@xterm/addon-fit/lib/addon-fit.mjs:
@xterm/addon-search/lib/addon-search.mjs:
  (**
   * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved.
   * @license MIT
   *
   * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
   * @license MIT
   *
   * Originally forked from (with the author's permission):
   *   Fabrice Bellard's javascript vt100 for jslinux:
   *   http://bellard.org/jslinux/
   *   Copyright (c) 2011 Fabrice Bellard
   *)

lit-html/lit-html.js:
lit-html/directive.js:
lit-html/directives/unsafe-html.js:
@lit/reactive-element/reactive-element.js:
lit-element/lit-element.js:
@lit/reactive-element/decorators/custom-element.js:
@lit/reactive-element/decorators/property.js:
@lit/reactive-element/decorators/state.js:
@lit/reactive-element/decorators/event-options.js:
@lit/reactive-element/decorators/base.js:
@lit/reactive-element/decorators/query.js:
@lit/reactive-element/decorators/query-all.js:
@lit/reactive-element/decorators/query-async.js:
@lit/reactive-element/decorators/query-assigned-nodes.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lucide/dist/esm/icons/circle.js:
lucide/dist/esm/icons/circle-check.js:
lucide/dist/esm/icons/circle-alert.js:
lucide/dist/esm/icons/loader.js:
lucide/dist/esm/icons/refresh-cw.js:
lucide/dist/esm/icons/arrow-down.js:
lucide/dist/esm/icons/pause.js:
lucide/dist/esm/icons/zap.js:
lucide/dist/esm/icons/clock.js:
lucide/dist/esm/icons/triangle-alert.js:
lucide/dist/esm/icons/activity.js:
lucide/dist/esm/icons/archive.js:
lucide/dist/esm/icons/search.js:
lucide/dist/esm/icons/arrow-left.js:
lucide/dist/esm/icons/square.js:
lucide/dist/esm/icons/play.js:
lucide/dist/esm/icons/users.js:
lucide/dist/esm/icons/shield.js:
lucide/dist/esm/icons/git-branch.js:
lucide/dist/esm/icons/chevron-right.js:
lucide/dist/esm/icons/save.js:
lucide/dist/esm/icons/settings.js:
lucide/dist/esm/icons/timer.js:
lucide/dist/esm/icons/cpu.js:
lucide/dist/esm/icons/star.js:
  (**
   * @license lucide v0.577.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/decorators/query-assigned-elements.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/directive-helpers.js:
lit-html/static.js:
lit-html/directives/live.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/directives/class-map.js:
lit-html/directives/if-defined.js:
  (**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
//# sourceMappingURL=main.bundle.js.map
