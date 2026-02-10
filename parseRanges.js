/* eslint-disable no-console */
'use strict';

function parseRanges(str, maxPages){
  // Supports: "1-3,5,7-9" (1-based)
  const out = [];
  const s = String(str||'').trim();
  if(!s) return out;
  for(const part of s.split(',').map(x=>x.trim()).filter(Boolean)){
    const closedRange = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const openEndRange = part.match(/^(\d+)\s*-\s*$/);
    const openStartRange = part.match(/^\s*-\s*(\d+)$/);

    if(closedRange || openEndRange || openStartRange){
      let a = 1;
      let b = maxPages;
      if(closedRange){
        a = parseInt(closedRange[1],10);
        b = parseInt(closedRange[2],10);
      }else if(openEndRange){
        a = parseInt(openEndRange[1],10);
      }else if(openStartRange){
        b = parseInt(openStartRange[1],10);
      }
      if(Number.isNaN(a)||Number.isNaN(b)) continue;
      if(a>b) [a,b]=[b,a];
      a = Math.max(1,a);
      b = Math.min(maxPages,b);
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
