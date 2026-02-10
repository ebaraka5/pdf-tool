/* eslint-disable no-console */
'use strict';

function parseRanges(str, maxPages){
  // Supports: "1-3,5,7-9" (1-based)
  const out = [];
  const s = String(str||'').trim();
  if(!s) return out;
  for(const part of s.split(',').map(x=>x.trim()).filter(Boolean)){
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if(m){
      let a = parseInt(m[1],10), b = parseInt(m[2],10);
      if(Number.isNaN(a)||Number.isNaN(b)) continue;
      if(a>b) [a,b]=[b,a];
      a = Math.max(1,a); b = Math.min(maxPages,b);
      for(let i=a;i<=b;i++) out.push(i);
    }else{
      const n = parseInt(part,10);
      if(!Number.isNaN(n) && n>=1 && n<=maxPages) out.push(n);
    }
  }
  // de-dupe preserve order
  const seen = new Set();
  return out.filter(p=> (seen.has(p)?false:(seen.add(p),true)));
}

if(typeof window !== 'undefined'){
  window.parseRanges = parseRanges;
}

if(typeof module !== 'undefined'){
  module.exports = { parseRanges };
}
