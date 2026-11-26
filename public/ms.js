/* Market-structure engine: trend, BOS/CHoCH state + shift trigger, confluence S/R (fib + FVG + swings + EMA).
   Works in the browser (window.MS) and in node (module.exports). Bars: {t:[sec],o,h,l,c,v}.
   19 Nov 2026: 1H timeframe added (structure, trend and flip levels; 5-bar pivots like 4H). Support/resistance
   clusters still come from 4H, 1D and 1W only, so the zones are unchanged. Everything else is the original engine.
   26 Nov 2026: 2H timeframe added for coins only (built from 1H with to2H; 5-bar pivots; structure only, zones unchanged).
   26 Nov 2026: 8H and 12H added for coins only (built from 4H with to8H / to12H; 8H 4-bar, 12H 3-bar pivots; structure only). */
(function(root){
'use strict';
const H1=3600,H2=7200,H4=14400,H8=28800,H12=43200,D1=86400,W1=604800;
const TFSEC={'1H':H1,'2H':H2,'8H':H8,'12H':H12,'4H':H4,'1D':D1,'1W':W1};
const TFS=['1H','2H','4H','8H','12H','1D','1W'];
const PIV={'1H':5,'2H':5,'8H':4,'12H':3,'4H':5,'1D':3,'1W':2};           // pivot left/right bars per timeframe
const TFW={'1H':0.5,'2H':0.75,'8H':1.2,'12H':1.3,'4H':1,'1D':1.5,'1W':2};          // weight of a level by timeframe
const slice=(B,a,b)=>{const o={};for(const k of 'tohlcv')o[k]=(B[k]||[]).slice(a,b);return o};
const last=a=>a[a.length-1];
function ema(c,n){if(c.length<n)return null;let k=2/(n+1),e=c.slice(0,n).reduce((a,b)=>a+b,0)/n;for(let i=n;i<c.length;i++)e=c[i]*k+e*(1-k);return e}
function atr(B,n=14){const L=B.c.length;if(L<n+1)return null;let s=0;for(let i=1;i<=n;i++)s+=tr(B,i);let a=s/n;for(let i=n+1;i<L;i++)a=(a*(n-1)+tr(B,i))/n;return a}
const tr=(B,i)=>Math.max(B.h[i]-B.l[i],Math.abs(B.h[i]-B.c[i-1]),Math.abs(B.l[i]-B.c[i-1]));
// drop the forming bar (open time + period > now)
function closedOnly(B,tf,now){let n=B.t.length;while(n&&B.t[n-1]+TFSEC[tf]>now)n--;return slice(B,0,n)}
function resample(B,period,anchor){const o={t:[],o:[],h:[],l:[],c:[],v:[]};let cur=null;
 for(let i=0;i<B.t.length;i++){const k=Math.floor((B.t[i]-anchor)/period)*period+anchor;
  if(cur!==k){cur=k;o.t.push(k);o.o.push(B.o[i]);o.h.push(B.h[i]);o.l.push(B.l[i]);o.c.push(B.c[i]);o.v.push(B.v?B.v[i]||0:0)}
  else{const j=o.t.length-1;o.h[j]=Math.max(o.h[j],B.h[i]);o.l[j]=Math.min(o.l[j],B.l[i]);o.c[j]=B.c[i];o.v[j]+=B.v?B.v[i]||0:0}}
 return o}
const MON=345600; // 1970-01-05 00:00 UTC, a Monday
const toWeek=B=>resample(B,W1,MON), toDay=B=>resample(B,D1,0);
// complete UTC-aligned candles only (like Binance 2h/8h/12h): a candle is kept only when all `need` source candles exist
function bucket(B,period,need){const R=resample(B,period,0),n={};B.t.forEach(t=>{const k=Math.floor(t/period)*period;n[k]=(n[k]||0)+1});
 const keep=R.t.map(t=>n[t]===need),o={};for(const k of 'tohlcv')o[k]=(R[k]||[]).filter((_,i)=>keep[i]);return o}
const to2H=B1=>bucket(B1,H2,2), to8H=B4=>bucket(B4,H8,2), to12H=B4=>bucket(B4,H12,3);

// ---------- swings ----------
// simpler, unambiguous pivot rule: strictly higher than right side, >= left side
function piv(B,n){const P=[];for(let i=n;i<B.c.length-n;i++){let ph=true,pl=true;
  for(let j=i-n;j<i;j++){if(B.h[j]>B.h[i])ph=false;if(B.l[j]<B.l[i])pl=false}
  for(let j=i+1;j<=i+n;j++){if(B.h[j]>=B.h[i])ph=false;if(B.l[j]<=B.l[i])pl=false}
  if(ph)P.push({i,type:'H',p:B.h[i],conf:i+n});if(pl)P.push({i,type:'L',p:B.l[i],conf:i+n})}
 return P}

// ---------- structure walk (close-based BOS / CHoCH) ----------
function structure(B,tf){
 const n=PIV[tf],P=piv(B,n),L=B.c.length;const byConf={};P.forEach(p=>{(byConf[p.conf]=byConf[p.conf]||[]).push(p)});
 let dir=0,sh=null,sl=null,shBroken=true,slBroken=true,prot=null,events=[],legStart=0;
 for(let i=0;i<L;i++){
  (byConf[i]||[]).forEach(p=>{if(p.type==='H'){sh=p;shBroken=false}else{sl=p;slBroken=false}});
  const c=B.c[i];
  if(dir>0&&prot&&c<prot.p){ // bullish structure broken: CHoCH down
   const hi=maxIdx(B.h,legStart,i);events.push({kind:'CHoCH',dir:-1,level:prot.p,i,t:B.t[i]});dir=-1;prot={p:B.h[hi],i:hi};legStart=i;slBroken=true;continue}
  if(dir<0&&prot&&c>prot.p){
   const lo=minIdx(B.l,legStart,i);events.push({kind:'CHoCH',dir:1,level:prot.p,i,t:B.t[i]});dir=1;prot={p:B.l[lo],i:lo};legStart=i;shBroken=true;continue}
  if(sh&&!shBroken&&c>sh.p&&dir>=0){const lo=minIdx(B.l,sh.i,i);events.push({kind:'BOS',dir:1,level:sh.p,i,t:B.t[i]});dir=1;prot={p:B.l[lo],i:lo};legStart=i;shBroken=true;continue}
  if(sl&&!slBroken&&c<sl.p&&dir<=0){const hi=maxIdx(B.h,sl.i,i);events.push({kind:'BOS',dir:-1,level:sl.p,i,t:B.t[i]});dir=-1;prot={p:B.h[hi],i:hi};legStart=i;slBroken=true;continue}
 }
 return {dir,events,prot,sh,sl,shBroken,slBroken,P,legStart}}
function maxIdx(a,s,e){let k=s;for(let i=s;i<=e;i++)if(a[i]>a[k])k=i;return k}
function minIdx(a,s,e){let k=s;for(let i=s;i<=e;i++)if(a[i]<a[k])k=i;return k}

// ---------- FVGs (unfilled) ----------
function fvgs(B,tf,lookback){const out=[],L=B.c.length,a=atr(B)||0,s=Math.max(2,L-lookback);
 for(let i=s;i<L;i++){
  if(B.l[i]>B.h[i-2]&&B.l[i]-B.h[i-2]>0.1*a){let lo=B.h[i-2],hi=B.l[i],alive=true;
   for(let j=i+1;j<L&&alive;j++){if(B.l[j]<=lo)alive=false;else if(B.l[j]<hi)hi=B.l[j]}
   if(alive&&hi>lo)out.push({lo,hi,role:'bull',method:'FVG',tf,t:B.t[i-1]})}
  if(B.h[i]<B.l[i-2]&&B.l[i-2]-B.h[i]>0.1*a){let lo=B.h[i],hi=B.l[i-2],alive=true;
   for(let j=i+1;j<L&&alive;j++){if(B.h[j]>=hi)alive=false;else if(B.h[j]>lo)lo=B.h[j]}
   if(alive&&hi>lo)out.push({lo,hi,role:'bear',method:'FVG',tf,t:B.t[i-1]})}}
 return out}

// ---------- per-timeframe analysis ----------
const FIBR=[0.382,0.5,0.618,0.705,0.786],FIBX=[1.272,1.618];
function analyzeTF(B,tf,live){
 const S=structure(B,tf),L=B.c.length,c=last(B.c),px=live!=null?live:c;
 const e20=ema(B.c,20),e50=ema(B.c,50),e200=ema(B.c,200),a=atr(B);
 // last two confirmed pivot highs / lows
 const PH=S.P.filter(p=>p.type==='H'),PL=S.P.filter(p=>p.type==='L');
 const h1=PH[PH.length-1],h0=PH[PH.length-2],l1=PL[PL.length-1],l0=PL[PL.length-2];
 const hh=h1&&h0?h1.p>h0.p:null,hl=l1&&l0?l1.p>l0.p:null;
 const sw=hh===true&&hl===true?1:hh===false&&hl===false?-1:0;
 const emaUp=e50&&c>e50&&e20>e50,emaDn=e50&&c<e50&&e20<e50;
 const swTxt=(hh==null?'?':hh?'higher high':'lower high')+' + '+(hl==null?'?':hl?'higher low':'lower low');
 let trend='Range',why='';
 if(sw===1&&S.dir>0){trend='Uptrend';why=swTxt+', bullish structure'}
 else if(sw===-1&&S.dir<0){trend='Downtrend';why=swTxt+', bearish structure'}
 else if(sw===0&&S.dir>0&&emaUp){trend='Uptrend';why='bullish structure above rising EMA20/50 ('+swTxt+')'}
 else if(sw===0&&S.dir<0&&emaDn){trend='Downtrend';why='bearish structure below falling EMA20/50 ('+swTxt+')'}
 else if(sw===-1&&S.dir>0)why='pullback inside bullish structure ('+swTxt+')';
 else if(sw===1&&S.dir<0)why='bounce inside bearish structure ('+swTxt+')';
 else why=swTxt+', EMAs not aligned with structure';
 // leg extreme since last break
 const ev=last(S.events)||null;
 const legHi=B.h[maxIdx(B.h,S.legStart,L-1)],legLo=B.l[minIdx(B.l,S.legStart,L-1)];
 let shift=null,cont=null;
 if(S.dir>0&&S.prot){shift={to:'Bearish',kind:'CHoCH',level:S.prot.p,t:B.t[S.prot.i],side:'below'};
  const up=(S.sh&&!S.shBroken&&S.sh.p>c)?S.sh.p:legHi;cont={kind:'BOS',level:up,side:'above',confirmed:!!(S.sh&&!S.shBroken&&S.sh.p>c)}}
 if(S.dir<0&&S.prot){shift={to:'Bullish',kind:'CHoCH',level:S.prot.p,t:B.t[S.prot.i],side:'above'};
  const dn=(S.sl&&!S.slBroken&&S.sl.p<c)?S.sl.p:legLo;cont={kind:'BOS',level:dn,side:'below',confirmed:!!(S.sl&&!S.slBroken&&S.sl.p<c)}}
 // internal (minor) shift: last opposite pivot inside the leg = early warning
 let minor=null;
 if(S.dir>0&&l1&&l1.i>(S.prot?S.prot.i:0)&&l1.p>(shift?shift.level:-Infinity))minor={level:l1.p,side:'below',t:B.t[l1.i]};
 if(S.dir<0&&h1&&h1.i>(S.prot?S.prot.i:0)&&h1.p<(shift?shift.level:Infinity))minor={level:h1.p,side:'above',t:B.t[h1.i]};
 const pend=shift?(shift.side==='below'?px<shift.level:px>shift.level):false;
 const contPend=cont?(cont.side==='above'?px>cont.level:px<cont.level):false;
 // fib of the active leg: from protected extreme to leg extreme
 let fib=null;
 if(S.dir>0&&S.prot){const lo=S.prot.p,hi=Math.max(legHi,B.h[maxIdx(B.h,S.prot.i,L-1)]);fib={from:lo,to:hi,dir:1}}
 if(S.dir<0&&S.prot){const hi=S.prot.p,lo=Math.min(legLo,B.l[minIdx(B.l,S.prot.i,L-1)]);fib={from:hi,to:lo,dir:-1}}
 return {tf,close:c,t:last(B.t),bars:L,atr:a,ema20:e20,ema50:e50,ema200:e200,
  trend,why,structure:S.dir>0?'Bullish':S.dir<0?'Bearish':'Undefined',
  last_event:ev?{kind:ev.kind,dir:ev.dir,level:ev.level,t:ev.t}:null,
  shift,cont,minor,pending:pend,cont_pending:contPend,fib,
  swings:{h:[h0&&h0.p,h1&&h1.p],l:[l0&&l0.p,l1&&l1.p]},
  _S:S,_PH:PH,_PL:PL}}

// ---------- confluence zones ----------
function candidates(TF,B){const C=[];
 for(const tf of ['4H','1D','1W']){const r=TF[tf];if(!r)continue;
  if(r.fib){const {from,to}=r.fib,d=to-from;
   FIBR.forEach(f=>C.push({p:to-d*f,method:'FIB',tf,label:tf+' fib '+f}));
   FIBX.forEach(f=>C.push({p:from+d*f,method:'FIBX',tf,label:tf+' ext '+f}))}
  if(r.shift)C.push({p:r.shift.level,method:'MSS',tf,label:tf+' structure flip level'});
  if(r.cont)C.push({p:r.cont.level,method:'MSS',tf,label:tf+' BOS level'});
  const n=tf==='4H'?6:tf==='1D'?10:10;
  r._PH.slice(-n).forEach(p=>C.push({p:p.p,method:'SWING',tf,label:tf+' swing high'}));
  r._PL.slice(-n).forEach(p=>C.push({p:p.p,method:'SWING',tf,label:tf+' swing low'}));
  if(r.ema200&&tf!=='4H')C.push({p:r.ema200,method:'EMA',tf,label:tf+' EMA200'});
  if(r.ema50&&tf==='1W')C.push({p:r.ema50,method:'EMA',tf,label:'1W EMA50'});
  fvgs(B[tf],tf,tf==='4H'?250:tf==='1D'?400:200).forEach(g=>C.push({lo:g.lo,hi:g.hi,p:(g.lo+g.hi)/2,method:'FVG',tf,label:tf+' '+(g.role==='bull'?'bullish':'bearish')+' FVG'}))}
 // 1-year range fib on 1D
 const D=B['1D'];if(D&&D.c.length>60){const n=Math.min(365,D.c.length),hi=Math.max(...D.h.slice(-n)),lo=Math.min(...D.l.slice(-n));
  [0.236,0.382,0.5,0.618,0.786].forEach(f=>C.push({p:hi-(hi-lo)*f,method:'FIB',tf:'1D',label:'1-yr range fib '+f}))}
 return C}
function zones(TF,B,px){const aD=TF['1D'].atr||px*0.03,band=0.1*aD,C=candidates(TF,B).filter(x=>isFinite(x.p)&&x.p>0);
 C.forEach(x=>{if(x.lo==null){x.lo=x.p-band;x.hi=x.p+band}});
 C.sort((a,b)=>a.p-b.p);const Z=[];
 for(const x of C){const z=last(Z);
  if(z&&x.lo<=z.hi+0.15*aD&&Math.max(z.hi,x.hi)-Math.min(z.lo,x.lo)<=0.7*aD){z.lo=Math.min(z.lo,x.lo);z.hi=Math.max(z.hi,x.hi);z.items.push(x)}
  else Z.push({lo:x.lo,hi:x.hi,items:[x]})}
 const out=Z.map(z=>{const keys={},meth={};z.items.forEach(x=>{keys[x.method+'|'+x.tf]=Math.max(keys[x.method+'|'+x.tf]||0,TFW[x.tf]);meth[x.method==='FIBX'?'FIB':x.method]=1});
  const score=Object.values(keys).reduce((a,b)=>a+b,0),nm=Object.keys(meth).length;
  const hasFib=!!meth.FIB,hasFvg=!!meth.FVG;
  const strength=(nm>=3&&score>=5)||(hasFib&&hasFvg&&score>=4)?'Strong':(nm>=2&&score>=3)?'Moderate':'Weak';
  const role=z.hi<px?'S':z.lo>px?'R':'IN';
  const labels=[...new Set(z.items.map(x=>x.label))];
  return {lo:z.lo,hi:z.hi,mid:(z.lo+z.hi)/2,role,score:+score.toFixed(1),methods:Object.keys(meth).sort(),tfs:[...new Set(z.items.map(x=>x.tf))],strength,labels,
   dist:role==='S'?(z.hi/px-1)*100:role==='R'?(z.lo/px-1)*100:0}});
 const keep=z=>z.strength!=='Weak';
 const S=out.filter(z=>z.role==='S'&&keep(z)).sort((a,b)=>b.hi-a.hi).slice(0,3);
 const R=out.filter(z=>z.role==='R'&&keep(z)).sort((a,b)=>a.lo-b.lo).slice(0,3);
 const IN=out.filter(z=>z.role==='IN'&&keep(z));
 return {S,R,IN}}

// ---------- coin analysis ----------
/* B4: 4H bars, BD: 1D bars (may include forming bars), now: unix sec. live: optional live price.
   opts.B1: 1H bars (optional). With 1H the price is the last closed 1H close.
   opts.B2 / opts.B8 / opts.B12: 2H, 8H, 12H bars (optional, coins only: to2H(B1), to8H(B4), to12H(B4)). */
function analyze(sym,B4,BD,now,opts){opts=opts||{};
 const c1=opts.B1&&opts.B1.c&&opts.B1.c.length?closedOnly(opts.B1,'1H',now):null;
 const c4=closedOnly(B4,'4H',now);
 const live=opts.live!=null?opts.live:c1&&c1.c.length&&last(c1.t)>=last(c4.t)?last(c1.c):last(c4.c);
 let cd=closedOnly(BD&&BD.c.length?BD:toDay(B4),'1D',now);
 const cw=closedOnly(toWeek(BD&&BD.c.length?BD:toDay(B4)),'1W',now);
 const B={'4H':c4.c.length>1000?slice(c4,-1000):c4,'1D':cd.c.length>1200?slice(cd,-1200):cd,'1W':cw};
 if(c1)B['1H']=c1.c.length>1000?slice(c1,-1000):c1;
 for(const [tf,X] of [['2H',opts.B2],['8H',opts.B8],['12H',opts.B12]])if(X&&X.c&&X.c.length){const cx=closedOnly(X,tf,now);B[tf]=cx.c.length>1000?slice(cx,-1000):cx}
 const TF={};for(const tf of TFS)if(B[tf]&&B[tf].c.length>=30)TF[tf]=analyzeTF(B[tf],tf,live);
 const Zs=TF['1D']?zones(TF,B,live):{S:[],R:[],IN:[]};
 const tfo={};for(const tf in TF){const r=Object.assign({},TF[tf]);delete r._S;delete r._PH;delete r._PL;
  r.dist_shift=r.shift?(r.shift.level/live-1)*100:null;r.dist_cont=r.cont?(r.cont.level/live-1)*100:null;tfo[tf]=r}
 const tr=TFS.filter(t=>tfo[t]).map(t=>tfo[t].trend);
 const align=tr.every(x=>x==='Uptrend')?'All up':tr.every(x=>x==='Downtrend')?'All down':'Mixed';
 const asof=Math.max(c4.t.length?last(c4.t)+H4:0,c1&&c1.t.length?last(c1.t)+H1:0)||now;
 return {sym,symbol:opts.symbol||null,source:opts.source||null,price:live,asof,built:now,align,tf:tfo,zones:Zs}}

// ---------- change detection ----------
function diff(prev,cur,now){const ev=[];if(!prev||!prev.tf)return ev;
 for(const tf of TFS){const a=prev.tf[tf],b=cur.tf[tf];if(!a||!b)continue;
  if(a.structure!==b.structure)ev.push({t:now,sym:cur.sym,tf,type:'structure',from:a.structure,to:b.structure,
   note:(b.last_event?b.last_event.kind+' ':'')+tf+' close '+(b.structure==='Bullish'?'above ':'below ')+fmt(b.last_event?b.last_event.level:b.close)});
  else if(b.last_event&&a.last_event&&b.last_event.t!==a.last_event.t&&b.last_event.kind==='BOS')ev.push({t:now,sym:cur.sym,tf,type:'bos',from:b.structure,to:b.structure,note:tf+' BOS continuation through '+fmt(b.last_event.level)});
  if(a.trend!==b.trend)ev.push({t:now,sym:cur.sym,tf,type:'trend',from:a.trend,to:b.trend,note:b.why});
  if(!a.pending&&b.pending)ev.push({t:now,sym:cur.sym,tf,type:'pending',from:b.structure,to:b.shift.to,note:'price beyond '+fmt(b.shift.level)+', needs '+tf+' close to confirm'})}
 return ev}
function fmt(x){if(x==null||!isFinite(x))return '-';const a=Math.abs(x);
 if(a>=1000)return x.toLocaleString('en-US',{maximumFractionDigits:0});if(a>=100)return x.toFixed(1);if(a>=10)return x.toFixed(2);
 if(a>=1)return x.toFixed(3);if(a>=0.1)return x.toFixed(4);if(a>=0.01)return x.toFixed(5);return x.toPrecision(3)}

const api={analyze,diff,fmt,toWeek,toDay,to2H,to8H,to12H,bucket,closedOnly,structure,fvgs,atr,ema,piv,TFSEC,TFS};
if(typeof module!=='undefined')module.exports=api;else root.MS=api;
})(typeof window!=='undefined'?window:globalThis);
