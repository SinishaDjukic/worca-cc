var R=globalThis,de=t=>t,z=R.trustedTypes,ue=z?z.createPolicy("lit-html",{createHTML:t=>t}):void 0,$e="$lit$",x=`lit$${Math.random().toFixed(9).slice(2)}$`,ve="?"+x,Pe=`<${ve}>`,M=document,P=()=>M.createComment(""),O=t=>t===null||typeof t!="object"&&typeof t!="function",se=Array.isArray,Oe=t=>se(t)||typeof t?.[Symbol.iterator]=="function",K=`[ 	
\f\r]`,k=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,pe=/-->/g,he=/>/g,S=RegExp(`>|${K}(?:([^\\s"'>=/]+)(${K}*=${K}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),ge=/'/g,fe=/"/g,_e=/^(?:script|style|textarea|title)$/i,ne=t=>(e,...s)=>({_$litType$:t,strings:e,values:s}),c=ne(1),Ze=ne(2),Qe=ne(3),V=Symbol.for("lit-noChange"),u=Symbol.for("lit-nothing"),me=new WeakMap,C=M.createTreeWalker(M,129);function Ae(t,e){if(!se(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return ue!==void 0?ue.createHTML(e):e}var Ve=(t,e)=>{let s=t.length-1,i=[],n,r=e===2?"<svg>":e===3?"<math>":"",o=k;for(let d=0;d<s;d++){let a=t[d],p,h,l=-1,f=0;for(;f<a.length&&(o.lastIndex=f,h=o.exec(a),h!==null);)f=o.lastIndex,o===k?h[1]==="!--"?o=pe:h[1]!==void 0?o=he:h[2]!==void 0?(_e.test(h[2])&&(n=RegExp("</"+h[2],"g")),o=S):h[3]!==void 0&&(o=S):o===S?h[0]===">"?(o=n??k,l=-1):h[1]===void 0?l=-2:(l=o.lastIndex-h[2].length,p=h[1],o=h[3]===void 0?S:h[3]==='"'?fe:ge):o===fe||o===ge?o=S:o===pe||o===he?o=k:(o=S,n=void 0);let v=o===S&&t[d+1].startsWith("/>")?" ":"";r+=o===k?a+Pe:l>=0?(i.push(p),a.slice(0,l)+$e+a.slice(l)+x+v):a+x+(l===-2?d:v)}return[Ae(t,r+(t[s]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),i]},j=class t{constructor({strings:e,_$litType$:s},i){let n;this.parts=[];let r=0,o=0,d=e.length-1,a=this.parts,[p,h]=Ve(e,s);if(this.el=t.createElement(p,i),C.currentNode=this.el.content,s===2||s===3){let l=this.el.content.firstChild;l.replaceWith(...l.childNodes)}for(;(n=C.nextNode())!==null&&a.length<d;){if(n.nodeType===1){if(n.hasAttributes())for(let l of n.getAttributeNames())if(l.endsWith($e)){let f=h[o++],v=n.getAttribute(l).split(x),b=/([.?@])?(.*)/.exec(f);a.push({type:1,index:r,name:b[2],strings:v,ctor:b[1]==="."?Q:b[1]==="?"?X:b[1]==="@"?ee:N}),n.removeAttribute(l)}else l.startsWith(x)&&(a.push({type:6,index:r}),n.removeAttribute(l));if(_e.test(n.tagName)){let l=n.textContent.split(x),f=l.length-1;if(f>0){n.textContent=z?z.emptyScript:"";for(let v=0;v<f;v++)n.append(l[v],P()),C.nextNode(),a.push({type:2,index:++r});n.append(l[f],P())}}}else if(n.nodeType===8)if(n.data===ve)a.push({type:2,index:r});else{let l=-1;for(;(l=n.data.indexOf(x,l+1))!==-1;)a.push({type:7,index:r}),l+=x.length-1}r++}}static createElement(e,s){let i=M.createElement("template");return i.innerHTML=e,i}};function E(t,e,s=t,i){if(e===V)return e;let n=i!==void 0?s._$Co?.[i]:s._$Cl,r=O(e)?void 0:e._$litDirective$;return n?.constructor!==r&&(n?._$AO?.(!1),r===void 0?n=void 0:(n=new r(t),n._$AT(t,s,i)),i!==void 0?(s._$Co??(s._$Co=[]))[i]=n:s._$Cl=n),n!==void 0&&(e=E(t,n._$AS(t,e.values),n,i)),e}var Z=class{constructor(e,s){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=s}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:s},parts:i}=this._$AD,n=(e?.creationScope??M).importNode(s,!0);C.currentNode=n;let r=C.nextNode(),o=0,d=0,a=i[0];for(;a!==void 0;){if(o===a.index){let p;a.type===2?p=new D(r,r.nextSibling,this,e):a.type===1?p=new a.ctor(r,a.name,a.strings,this,e):a.type===6&&(p=new te(r,this,e)),this._$AV.push(p),a=i[++d]}o!==a?.index&&(r=C.nextNode(),o++)}return C.currentNode=M,n}p(e){let s=0;for(let i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,s),s+=i.strings.length-2):i._$AI(e[s])),s++}},D=class t{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,s,i,n){this.type=2,this._$AH=u,this._$AN=void 0,this._$AA=e,this._$AB=s,this._$AM=i,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,s=this._$AM;return s!==void 0&&e?.nodeType===11&&(e=s.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,s=this){e=E(this,e,s),O(e)?e===u||e==null||e===""?(this._$AH!==u&&this._$AR(),this._$AH=u):e!==this._$AH&&e!==V&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):Oe(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==u&&O(this._$AH)?this._$AA.nextSibling.data=e:this.T(M.createTextNode(e)),this._$AH=e}$(e){let{values:s,_$litType$:i}=e,n=typeof i=="number"?this._$AC(e):(i.el===void 0&&(i.el=j.createElement(Ae(i.h,i.h[0]),this.options)),i);if(this._$AH?._$AD===n)this._$AH.p(s);else{let r=new Z(n,this),o=r.u(this.options);r.p(s),this.T(o),this._$AH=r}}_$AC(e){let s=me.get(e.strings);return s===void 0&&me.set(e.strings,s=new j(e)),s}k(e){se(this._$AH)||(this._$AH=[],this._$AR());let s=this._$AH,i,n=0;for(let r of e)n===s.length?s.push(i=new t(this.O(P()),this.O(P()),this,this.options)):i=s[n],i._$AI(r),n++;n<s.length&&(this._$AR(i&&i._$AB.nextSibling,n),s.length=n)}_$AR(e=this._$AA.nextSibling,s){for(this._$AP?.(!1,!0,s);e!==this._$AB;){let i=de(e).nextSibling;de(e).remove(),e=i}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},N=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,s,i,n,r){this.type=1,this._$AH=u,this._$AN=void 0,this.element=e,this.name=s,this._$AM=n,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=u}_$AI(e,s=this,i,n){let r=this.strings,o=!1;if(r===void 0)e=E(this,e,s,0),o=!O(e)||e!==this._$AH&&e!==V,o&&(this._$AH=e);else{let d=e,a,p;for(e=r[0],a=0;a<r.length-1;a++)p=E(this,d[i+a],s,a),p===V&&(p=this._$AH[a]),o||(o=!O(p)||p!==this._$AH[a]),p===u?e=u:e!==u&&(e+=(p??"")+r[a+1]),this._$AH[a]=p}o&&!n&&this.j(e)}j(e){e===u?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},Q=class extends N{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===u?void 0:e}},X=class extends N{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==u)}},ee=class extends N{constructor(e,s,i,n,r){super(e,s,i,n,r),this.type=5}_$AI(e,s=this){if((e=E(this,e,s,0)??u)===V)return;let i=this._$AH,n=e===u&&i!==u||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==u&&(i===u||n);n&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},te=class{constructor(e,s,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=s,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){E(this,e)}};var je=R.litHtmlPolyfillSupport;je?.(j,D),(R.litHtmlVersions??(R.litHtmlVersions=[])).push("3.3.2");var be=(t,e,s)=>{let i=s?.renderBefore??e,n=i._$litPart$;if(n===void 0){let r=s?.renderBefore??null;i._$litPart$=n=new D(e.insertBefore(P(),r),r,void 0,s??{})}return n._$AI(t),n};function we(t={}){let e={activeRunId:t.activeRunId??null,runs:t.runs??{},logLines:t.logLines??[],preferences:{theme:t.preferences?.theme??"light",sidebarCollapsed:t.preferences?.sidebarCollapsed??!1}},s=new Set;function i(){for(let n of Array.from(s))try{n(e)}catch{}}return{getState(){return e},setState(n){let r={...e,...n,preferences:{...e.preferences,...n.preferences||{}}};r.activeRunId===e.activeRunId&&r.runs===e.runs&&r.logLines===e.logLines&&r.preferences.theme===e.preferences.theme&&r.preferences.sidebarCollapsed===e.preferences.sidebarCollapsed||(e=r,i())},setRun(n,r){let o={...e.runs,[n]:r};e={...e,runs:o},i()},appendLog(n){let r=[...e.logLines,n];r.length>5e3&&r.splice(0,r.length-5e3),e={...e,logLines:r},i()},clearLog(){e={...e,logLines:[]},i()},subscribe(n){return s.add(n),()=>s.delete(n)}}}var xe=["subscribe-run","unsubscribe-run","subscribe-log","unsubscribe-log","list-runs","get-preferences","set-preferences","run-snapshot","run-update","runs-list","log-line","log-bulk","preferences"];function ie(){let t=Date.now().toString(36),e=Math.random().toString(36).slice(2,8);return`${t}-${e}`}function ye(t,e,s=ie()){return{id:s,type:t,payload:e}}function Se(t={}){let e={initialMs:t.backoff?.initialMs??1e3,maxMs:t.backoff?.maxMs??3e4,factor:t.backoff?.factor??2,jitterRatio:t.backoff?.jitterRatio??.2},s=()=>t.url&&t.url.length>0?t.url:typeof location<"u"?(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws":"ws://localhost/ws",i=null,n="closed",r=0,o=null,d=!0,a=new Map,p=[],h=new Map,l=new Set;function f(g){for(let m of Array.from(l))try{m(g)}catch{}}function v(){if(!d||o)return;n="reconnecting",f(n);let g=Math.min(e.maxMs,e.initialMs*Math.pow(e.factor,r)),m=e.jitterRatio*g,w=Math.max(0,Math.round(g+(Math.random()*2-1)*m));o=setTimeout(()=>{o=null,ce()},w)}function b(g){try{i?.send(JSON.stringify(g))}catch{}}function F(){for(n="open",f(n),r=0;p.length;){let g=p.shift();g&&b(g)}}function G(g){let m;try{m=JSON.parse(String(g.data))}catch{return}if(!m||typeof m.id!="string"||typeof m.type!="string")return;if(a.has(m.id)){let y=a.get(m.id);a.delete(m.id),m.ok?y?.resolve(m.payload):y?.reject(m.error||new Error("ws error"));return}let w=h.get(m.type);if(w&&w.size>0)for(let y of Array.from(w))try{y(m.payload)}catch{}}function I(){n="closed",f(n);for(let[g,m]of a.entries())m.reject(new Error("ws disconnected")),a.delete(g);r+=1,v()}function ce(){if(!d)return;let g=s();try{i=new WebSocket(g),n="connecting",f(n),i.addEventListener("open",F),i.addEventListener("message",G),i.addEventListener("error",()=>{}),i.addEventListener("close",I)}catch{v()}}return ce(),{send(g,m){if(!xe.includes(g))return Promise.reject(new Error(`unknown message type: ${g}`));let w=ie(),y=ye(g,m,w);return new Promise((ke,Re)=>{a.set(w,{resolve:ke,reject:Re,type:g}),i&&i.readyState===i.OPEN?b(y):p.push(y)})},on(g,m){h.has(g)||h.set(g,new Set);let w=h.get(g);return w?.add(m),()=>{w?.delete(m)}},onConnection(g){return l.add(g),()=>{l.delete(g)}},close(){d=!1,o&&(clearTimeout(o),o=null);try{i?.close()}catch{}},getState(){return n}}}function re(t){let e=(t||"").replace(/^#\/?/,""),[s,i]=e.split("?"),n=s||"active",r=new URLSearchParams(i||"");return{section:n,runId:r.get("run")||null}}function De(t,e){let s=`#/${t}`;return e?`${s}?run=${e}`:s}function Ce(t){let e=()=>t(re(location.hash));return window.addEventListener("hashchange",e),()=>window.removeEventListener("hashchange",e)}function J(t,e){location.hash=De(t,e)}function B(t){document.documentElement.setAttribute("data-theme",t)}function Me(t,e,s,{onNavigate:i,onThemeToggle:n}){let{runs:r,preferences:o}=t,d=Object.values(r),a=d.filter(f=>f.active).length,p=d.filter(f=>!f.active).length,h=s==="open"?"connected":s==="reconnecting"?"reconnecting":"disconnected",l=s==="open"?"Connected":s==="reconnecting"?"Reconnecting\u2026":"Disconnected";return c`
    <aside class="sidebar ${o.sidebarCollapsed?"collapsed":""}">
      <div class="sidebar-logo">
        <span class="logo-text">WORCA</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">Pipeline</div>
        <div class="sidebar-item ${e.section==="active"?"active":""}"
             @click=${()=>i("active")}>
          Active
          ${a>0?c`<span class="badge">${a}</span>`:""}
        </div>
        <div class="sidebar-item ${e.section==="history"?"active":""}"
             @click=${()=>i("history")}>
          History
          ${p>0?c`<span class="badge">${p}</span>`:""}
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="connection-indicator ${h}">
          <span class="conn-dot"></span>
          <span class="conn-label">${l}</span>
        </div>
        <button class="theme-toggle" @click=${n}>
          ${o.theme==="dark"?"\u2600":"\u263E"}
        </button>
      </div>
    </aside>
  `}var Be={pending:"status-pending",in_progress:"status-in-progress",completed:"status-completed",error:"status-error"},Ue={pending:"\u25CB",in_progress:"\u25CF",completed:"\u2713",error:"\u2717"};function T(t){return Be[t]||"status-unknown"}function L(t){return Ue[t]||"?"}function qe(t,e){return e&&e[t]?.label?e[t].label:t.replace(/_/g," ").replace(/\b\w/g,s=>s.toUpperCase())}function Te(t,e={},s={}){if(!t||typeof t!="object")return c``;let i=Object.entries(t);return i.length===0?c`<div class="empty-state">No stages</div>`:c`
    <div class="stage-timeline">
      ${i.map(([n,r],o)=>{let d=r.status||"pending",a=L(d),p=qe(n,e),h=d==="in_progress",l=s[`${n}_approval`],f=r.iteration;return c`
          ${o>0?c`<div class="stage-connector ${i[o-1]?.[1]?.status==="completed"?"completed":""}"></div>`:""}
          <div class="stage-node ${T(d)} ${h?"pulse":""}">
            <div class="stage-icon">${a}</div>
            <div class="stage-label">${p}</div>
            ${f>1?c`<span class="loop-indicator">\u21BB${f}</span>`:""}
            ${l?c`<span class="milestone-marker">\u2691</span>`:""}
          </div>
        `})}
    </div>
  `}function U(t){let e=Math.floor(t/1e3),s=Math.floor(e/3600),i=Math.floor(e%3600/60),n=e%60;return s>0?`${s}h ${i}m ${n}s`:i>0?`${i}m ${n}s`:`${n}s`}function q(t,e){let s=new Date(t).getTime();return(e?new Date(e).getTime():Date.now())-s}function Le(t,e={}){if(!t)return c`<div class="empty-state">Select a run to view details</div>`;let s=t.work_request?.title||"Untitled Run",i=t.work_request?.branch||"",n=t.pr_url||null,r=t.started_at?U(q(t.started_at,t.completed_at||null)):"",o=t.stages||{},d=e.stageUi||{},a=e.milestones||{},p=e.agents||{};return c`
    <div class="run-detail">
      <div class="run-header">
        <div class="run-header-left">
          <h2 class="run-title">${s}</h2>
          <span class="status-badge ${T(t.active?"in_progress":"completed")}">
            ${L(t.active?"in_progress":"completed")}
            ${t.active?"Running":"Completed"}
          </span>
        </div>
        <div class="run-header-right">
          ${i?c`<span class="run-meta"><span class="meta-label">Branch:</span> ${i}</span>`:u}
          ${r?c`<span class="run-meta"><span class="meta-label">Duration:</span> ${r}</span>`:u}
          ${n?c`<a class="run-meta run-pr-link" href="${n}" target="_blank">View PR</a>`:u}
        </div>
      </div>

      ${Te(o,d,a)}

      <div class="stage-panels">
        ${Object.entries(o).map(([h,l])=>{let f=d[h]?.label||h.replace(/_/g," ").replace(/\b\w/g,I=>I.toUpperCase()),v=l.status||"pending",b=Object.keys(p).find(I=>I===h)||null,F=b?p[b]:null,G=l.started_at?U(q(l.started_at,l.completed_at||null)):"";return c`
            <details class="stage-panel" ?open=${v==="in_progress"}>
              <summary class="stage-panel-header">
                <span class="stage-panel-icon ${T(v)}">${L(v)}</span>
                <span class="stage-panel-label">${f}</span>
                <span class="stage-panel-status">${v.replace(/_/g," ")}</span>
              </summary>
              <div class="stage-detail">
                ${l.started_at?c`<div class="detail-row"><span class="detail-label">Started:</span> ${new Date(l.started_at).toLocaleTimeString()}</div>`:u}
                ${l.completed_at?c`<div class="detail-row"><span class="detail-label">Completed:</span> ${new Date(l.completed_at).toLocaleTimeString()}</div>`:u}
                ${G?c`<div class="detail-row"><span class="detail-label">Duration:</span> ${G}</div>`:u}
                ${F?c`<div class="detail-row"><span class="detail-label">Agent:</span> ${b} (${F.model})</div>`:u}
                ${l.iteration>1?c`<div class="detail-row"><span class="detail-label">Iteration:</span> ${l.iteration}</div>`:u}
                ${l.task_progress?c`<div class="detail-row"><span class="detail-label">Progress:</span> ${l.task_progress}</div>`:u}
                ${l.error?c`<div class="detail-row detail-error"><span class="detail-label">Error:</span> ${l.error}</div>`:u}
              </div>
            </details>
          `})}
      </div>
    </div>
  `}function oe(t,e,{onSelectRun:s}){let i=t.filter(n=>e==="active"?n.active:!n.active);return i.length===0?c`<div class="empty-state">
      ${e==="active"?"No active pipeline runs":"No completed runs yet"}
    </div>`:c`
    <div class="run-list">
      ${i.map(n=>{let r=n.work_request?.title||"Untitled",o=n.active?"in_progress":n.stage==="error"?"error":"completed",d=n.started_at?U(q(n.started_at,n.completed_at||null)):"";return c`
          <div class="run-list-item" @click=${()=>s(n.id)}>
            <span class="run-list-status ${T(o)}">${L(o)}</span>
            <div class="run-list-info">
              <span class="run-list-title">${r}</span>
              <span class="run-list-meta">${n.stage||"pending"} \u00B7 ${d}</span>
            </div>
          </div>
        `})}
    </div>
  `}function He(t){let e=Object.values(t.runs),s=e.filter(r=>r.active),i=e.filter(r=>!r.active),n=e.filter(r=>(r.stages?Object.values(r.stages):[]).some(d=>d.status==="error"));return c`
    <div class="dashboard">
      <h2 class="dashboard-title">Pipeline Overview</h2>
      <div class="dashboard-stats">
        <div class="stat-card">
          <span class="stat-number">${s.length}</span>
          <span class="stat-label">Active</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${i.length}</span>
          <span class="stat-label">Completed</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${n.length}</span>
          <span class="stat-label">Errors</span>
        </div>
      </div>

      ${s.length>0?c`
        <h3 class="dashboard-section-title">Active Runs</h3>
        ${s.map(r=>c`
          <div class="run-list-item">
            <div class="run-list-info">
              <span class="run-list-title">${r.work_request?.title||"Untitled"}</span>
              <span class="run-list-meta">Stage: ${r.stage||"pending"}</span>
            </div>
          </div>
        `)}
      `:c`<div class="empty-state">No active pipeline runs</div>`}
    </div>
  `}function Ee(t,{onStageFilter:e,onSearch:s,onToggleAutoScroll:i,autoScroll:n}){let{logLines:r}=t,o=[...new Set(r.map(d=>d.stage).filter(Boolean))];return c`
    <div class="log-viewer">
      <div class="log-controls">
        <select class="log-stage-filter" @change=${d=>e(d.target.value)}>
          <option value="*">All Stages</option>
          ${o.map(d=>c`<option value="${d}">${d}</option>`)}
        </select>
        <input class="log-search" type="text" placeholder="Filter logs\u2026"
               @input=${d=>s(d.target.value)} />
        <button class="log-autoscroll-btn ${n?"active":""}"
                @click=${i}
                title="${n?"Auto-scroll on":"Auto-scroll off"}">
          ${n?"\u2193 Auto":"\u2193 Paused"}
        </button>
      </div>
      <div class="log-lines" id="log-lines">
        ${r.length===0?c`<div class="log-empty">No log output yet</div>`:r.map(d=>c`
            <div class="log-line">
              ${d.timestamp?c`<span class="log-timestamp">${d.timestamp}</span>`:u}
              ${d.stage?c`<span class="log-stage-tag">${d.stage}</span>`:u}
              <span class="log-text">${d.line||d}</span>
            </div>
          `)}
      </div>
    </div>
  `}var _=we(),$=Se(),A=re(location.hash),Ie=$.getState(),Y=!0,W="*",ae="",le={};$.on("runs-list",t=>{let e={};for(let s of t.runs||[])e[s.id]=s;_.setState({runs:e}),t.settings&&(le=t.settings)});$.on("run-snapshot",t=>{t&&t.id&&_.setRun(t.id,t)});$.on("run-update",t=>{t&&t.id&&_.setRun(t.id,t)});$.on("log-line",t=>{t&&_.appendLog(t)});$.on("log-bulk",t=>{if(t&&Array.isArray(t.lines))for(let e of t.lines)_.appendLog({stage:t.stage,line:e})});$.on("preferences",t=>{t&&(_.setState({preferences:t}),B(t.theme||"light"))});$.onConnection(t=>{Ie=t,t==="open"&&($.send("list-runs").then(e=>{let s={};for(let i of e.runs||[])s[i.id]=i;_.setState({runs:s}),e.settings&&(le=e.settings)}).catch(()=>{}),$.send("get-preferences").then(e=>{_.setState({preferences:e}),B(e.theme||"light")}).catch(()=>{}),A.runId&&($.send("subscribe-run",{runId:A.runId}).catch(()=>{}),$.send("subscribe-log",{stage:W==="*"?null:W}).catch(()=>{}))),H()});Ce(t=>{let e=A.runId;A=t,e&&e!==A.runId&&($.send("unsubscribe-run").catch(()=>{}),$.send("unsubscribe-log").catch(()=>{}),_.clearLog()),A.runId&&A.runId!==e&&($.send("subscribe-run",{runId:A.runId}).catch(()=>{}),$.send("subscribe-log",{stage:null}).catch(()=>{})),H()});function We(t){J(t,null)}function Ne(t){J(A.section,t)}function Fe(){let e=_.getState().preferences.theme==="dark"?"light":"dark";$.send("set-preferences",{theme:e}).catch(()=>{}),_.setState({preferences:{theme:e}}),B(e)}function Ge(t){W=t,H()}function ze(t){ae=t,H()}function Je(){Y=!Y,H()}function Ye(){let t=_.getState(),e=Object.values(t.runs);if(A.runId){let s=t.runs[A.runId];return c`
      ${Le(s,le)}
      ${Ee(Ke(t),{onStageFilter:Ge,onSearch:ze,onToggleAutoScroll:Je,autoScroll:Y})}
    `}if(A.section==="history")return oe(e,"history",{onSelectRun:Ne});if(A.section==="active"){let s=e.filter(i=>i.active);return s.length===1?(J("active",s[0].id),c``):oe(e,"active",{onSelectRun:Ne})}return He(t)}function Ke(t){let e=t.logLines;if(W!=="*"&&(e=e.filter(s=>s.stage===W)),ae){let s=ae.toLowerCase();e=e.filter(i=>(i.line||"").toLowerCase().includes(s))}return{...t,logLines:e}}function H(){let t=_.getState(),e=document.getElementById("app");if(e&&(be(c`
    <div class="app-shell">
      ${Me(t,A,Ie,{onNavigate:We,onThemeToggle:Fe})}
      <main class="main-content">
        ${Ye()}
      </main>
    </div>
  `,e),Y)){let s=document.getElementById("log-lines");s&&(s.scrollTop=s.scrollHeight)}}_.subscribe(()=>H());B(_.getState().preferences.theme);H();
//# sourceMappingURL=main.bundle.js.map
