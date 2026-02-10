/* eslint-disable no-console */
'use strict';

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function el(id){ return document.getElementById(id); }

function requireGlobal(name){
  const v = window[name];
  if(!v) throw new Error(`${name} is not loaded. Check that dependency scripts are reachable and not blocked by CSP.`);
  return v;
}
function getPDFLib(){ return requireGlobal('PDFLib'); }
function getPDFJS(){ return requireGlobal('pdfjsLib'); }

function ensurePdfjsWorker(){
  const pdfjsLib = getPDFJS();
  try{
    if(!pdfjsLib.GlobalWorkerOptions.workerSrc){
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
  }catch(_){}
  return pdfjsLib;
}

function toast(msg){
  const out = el('output');
  out.textContent = String(msg || '');
}

function showFatalError(msg){
  console.error(msg);
  const box = document.createElement('div');
  box.style.position='fixed';
  box.style.inset='16px';
  box.style.maxWidth='900px';
  box.style.margin='0 auto';
  box.style.background='rgba(15,26,46,.98)';
  box.style.border='1px solid rgba(255,255,255,.14)';
  box.style.borderRadius='14px';
  box.style.padding='16px';
  box.style.zIndex='9999';
  box.innerHTML = `<h3 style="margin:0 0 8px 0;">PDF Workspace failed to start</h3>
    <div style="opacity:.9; line-height:1.35;">${escapeHtml(String(msg))}</div>
    <div style="margin-top:10px; opacity:.8;">Common causes: blocked CDN scripts (CSP), offline connection, or cached old files.</div>`;
  document.body.appendChild(box);
}

function hashHue(str){
  const s = String(str||'');
  let h = 0;
  for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function loadFavs(){
  try{
    const raw = localStorage.getItem('pdfws_favs') || '[]';
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  }catch(_){ return new Set(); }
}
function saveFavs(set){
  try{ localStorage.setItem('pdfws_favs', JSON.stringify(Array.from(set))); }catch(_){}
}
function loadCompact(){
  try{ return localStorage.getItem('pdfws_compact') === '1'; }catch(_){ return false; }
}
function saveCompact(v){
  try{ localStorage.setItem('pdfws_compact', v ? '1' : '0'); }catch(_){}
}

async function readPDFjs(file){
  const pdfjsLib = ensurePdfjsWorker();
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  return await loadingTask.promise;
}

async function renderPreview(file, pageNum){
  const note = el('preview-note');
  const canvas = el('preview-canvas');
  const ctx = canvas.getContext('2d');
  note.textContent = '';
  try{
    if(!file) { note.textContent='Upload a PDF to preview.'; return; }
    if(file.type !== 'application/pdf') { note.textContent='Preview supports PDFs only.'; return; }

    const pdf = await readPDFjs(file);
    const pn = Math.min(Math.max(1, pageNum||1), pdf.numPages);
    const page = await pdf.getPage(pn);
    const viewport = page.getViewport({ scale: 1.25 });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    note.textContent = `Showing page ${pn} of ${pdf.numPages}.`;
  }catch(e){
    note.textContent = 'Preview error: ' + (e?.message||e);
  }
}

async function downloadOutput(files){
  // files: [{name, bytes}]
  if(!Array.isArray(files) || !files.length) return;
  for(const f of files){
    const blob = new Blob([f.bytes], {type:'application/pdf'});
    if(window.saveAs){
      window.saveAs(blob, f.name);
    }else{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 250);
    }
  }
}

async function downloadAsZip(files, zipName){
  if(!window.JSZip) throw new Error('JSZip not loaded.');
  const zip = new JSZip();
  files.forEach(f=>zip.file(f.name, f.bytes));
  const blob = await zip.generateAsync({type:'blob'});
  if(window.saveAs){ window.saveAs(blob, zipName); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 250);
}

async function extractTextFromPDF(file){
  const pdf = await readPDFjs(file);
  let all = '';
  const maxPages = Math.min(3, pdf.numPages);
  for(let p=1;p<=maxPages;p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    all += tc.items.map(it=>it.str).join(' ') + '\n';
  }
  return all;
}

const state = {
  files: /** @type {File[]} */([]),
  toolId: '',
  tool: null,
  onFilesChanged: [],
  favorites: loadFavs(),
  compact: loadCompact(),
  lastToolDefaults: new Map(),
  depsReady: false,
  runLabel: 'Process',
};

function assignToolIcons(){
  const byId = {
    merge: '📎',
    extract: '✂️',
    reorder: '🔀',
    reverse: '🔁',
    rotate: '🔄',
    oddeven: '🌓',
    interleave: '🧵',
    batchslicer: '🧷',
    invoice: '🧾',
    removeblank: '🧹',
    pagenumber: '🔟',
    watermark: '🏷️',
    bates: '⚖️',
    redact: '🟥',
    protect: '🔒',
    unlock: '🔓',
    flatten: '🧱',
    metadata: '🧬',
    metaedit: '🪪',
    piiscan: '🛡️',
    audit: '🔎',
    imagestopdf: '🖼️',
    topng: '🧊',
    html2pdf: '🌐',
    validate: '✅',
    repair: '🛠️',
    compress: '🗜️',
    categorize: '🗂️',
    formfill: '📝',
    sign: '✍️'
  };

  const used = new Set(Object.values(byId));
  const pool = [
    '📄','📁','📌','🧩','🧠','🧰','🧮','🗃️','🗳️','🧯','🪄','🧫','🧪','🧱','🧲','🧷','🪛','🪚',
    '🛰️','🗺️','📦','📇','🪙','🧾','🗞️','🖨️','🧬','🔍','🔒','🔓','✅','⚠️','⛔'
  ].filter(x=>!used.has(x));

  tools.forEach(t=>{
    const id = String(t.id||'').toLowerCase();
    if(byId[id]) { t.icon = byId[id]; return; }
    if(!t.icon){
      t.icon = pool.length ? pool.shift() : '📄';
    }
  });
}
// ---------- Tool Registry ----------
const tools = [
  simpleToolMerge(),
  simpleToolExtract(),
  simpleToolReorder(),
  simpleToolRotate(),
  simpleToolReverse(),
  simpleToolOddEven(),
  simpleToolRemoveBlank(),
  simpleToolPageNumber(),
  simpleToolWatermark(),
  simpleToolBates(),
  simpleToolSign(),
  simpleToolRedact(),
  simpleToolPIIScan(),
  simpleToolMetadata(),
  simpleToolAudit(),
  simpleToolCompress(),
  simpleToolRepair(),
  simpleToolValidate(),
  simpleToolCategorizeStub(),
  simpleToolFormFillStub(),
  simpleToolImagesToPDF(),
  simpleToolPDFToPNG(),
  simpleToolHTMLToPDF()
];

function bindSidebarControls(){
  const btn = el('compact-toggle');
  if(!btn) return;
  const apply = ()=>{
    btn.textContent = state.compact ? 'Expand sidebar' : 'Compact sidebar';
    document.body.classList.toggle('compact', !!state.compact);
    saveCompact(!!state.compact);
    buildSidebar();
  };
  btn.addEventListener('click', ()=>{
    state.compact = !state.compact;
    apply();
  });
  apply();
}

function buildSidebar(){
  const host = el('tool-list');
  host.innerHTML = '';

  document.body.classList.toggle('compact', !!state.compact);

  const makeSection = (title)=>{
    const h = document.createElement('div');
    h.className = 'tool-section';
    h.textContent = title;
    host.appendChild(h);
  };

  const renderToolBtn = (t)=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-btn';
    btn.dataset.tool = t.id;
    btn.setAttribute('data-tool-item','1');
    btn.setAttribute('data-tool-hay', `${t.name} ${t.category||''} ${t.desc||''}`);
    btn.title = t.name;

    const hue = hashHue(t.category||t.id);
    btn.style.setProperty('--catHue', String(hue));

    const pill = escapeHtml(t.accept==='pdf'?'PDF':t.accept==='images'?'Images':'Mixed');
    const isFav = state.favorites && state.favorites.has(t.id);

    btn.innerHTML = `
      <span class="tool-left">
        <span class="tool-ic">${escapeHtml(t.icon||'📄')}</span>
        <span class="tool-txt">${escapeHtml(t.name)}</span>
      </span>
      <span class="tool-right">
        <button class="pin-btn" type="button" title="${isFav?'Unfavorite':'Favorite'}" aria-label="${isFav?'Unfavorite':'Favorite'}">${isFav?'⭐':'☆'}</button>
        <span class="pill">${pill}</span>
      </span>
    `;

    btn.addEventListener('click', (e)=>{
      if(e.target && (/** @type {HTMLElement} */(e.target)).classList.contains('pin-btn')) return;
      setTool(t.id);
    });

    const pin = btn.querySelector('.pin-btn');
    pin.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      if(!state.favorites) state.favorites = new Set();
      if(state.favorites.has(t.id)) state.favorites.delete(t.id);
      else state.favorites.add(t.id);
      saveFavs(state.favorites);
      buildSidebar();
    });

    return btn;
  };

  const byName = [...tools].sort((a,b)=>String(a.name).localeCompare(String(b.name)));

  const favs = byName.filter(t=>state.favorites && state.favorites.has(t.id));
  if(favs.length){
    makeSection('⭐ Favorites');
    favs.forEach(t=>host.appendChild(renderToolBtn(t)));
  }

  const groups = new Map();
  byName.forEach(t=>{
    const cat = t.category || 'Tools';
    if(!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(t);
  });

  for(const [cat, list] of groups.entries()){
    const rest = list.filter(t=>!(state.favorites && state.favorites.has(t.id)));
    if(!rest.length) continue;
    makeSection(cat);
    rest.forEach(t=>host.appendChild(renderToolBtn(t)));
  }

  const active = state.toolId;
  host.querySelectorAll('button.tool-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.tool === active);
  });
}

function bindToolSearch(){
  const inp = el('tool-search');
  if(!inp) return;
  inp.addEventListener('input', ()=>{
    const q = String(inp.value||'').trim().toLowerCase();
    document.querySelectorAll('[data-tool-item="1"]').forEach(node=>{
      const hay = String((/** @type {HTMLElement} */(node)).getAttribute('data-tool-hay')||'').toLowerCase();
      (/** @type {HTMLElement} */(node)).style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  });
}

function setTool(id){
  const tool = tools.find(t=>t.id===id);
  if(!tool) return;
  state.toolId = id;
  state.tool = tool;

  el('tool-title').textContent = `${tool.icon||'📄'} ${tool.name}`;
  el('tool-desc').textContent = tool.desc || '';

  const ui = el('tool-ui');
  ui.innerHTML = '';

  // Basic help blocks
  const how = document.createElement('div');
  how.className = 'mini';
  how.innerHTML = `<b>How it works:</b> ${escapeHtml(tool.how || 'Runs locally in your browser on the files you upload.')}`;
  ui.appendChild(how);

  const warn = document.createElement('div');
  warn.className = 'warn';
  warn.style.marginTop = '10px';
  warn.innerHTML = `<b>Common mistakes:</b> ${escapeHtml(tool.mistakes || 'Make sure the correct file type is uploaded and try again if a PDF is password-protected.')}`;
  ui.appendChild(warn);

  const tips = document.createElement('details');
  tips.style.marginTop='10px';
  tips.innerHTML = `<summary><b>Advanced tips</b></summary><div class="mini" style="margin-top:8px;">${escapeHtml(tool.tips || 'Use smaller test files first. If you batch many files, prefer ZIP download for reliability.')}</div>`;
  ui.appendChild(tips);

  const opts = document.createElement('div');
  opts.className='panel';
  opts.style.marginTop='10px';
  opts.innerHTML = `<h3 style="margin:0 0 10px;">Options</h3><div id="tool-options"></div>`;
  ui.appendChild(opts);

  const optRoot = opts.querySelector('#tool-options');
  tool.buildOptions?.(optRoot);

  updateRunEnabled();
  // deep link
  try{
    const u = new URL(location.href);
    u.hash = `#tool=${encodeURIComponent(id)}`;
    history.replaceState(null,'',u.toString());
  }catch(_){}

  // update preview immediately for selected tool
  const pdf = state.files.find(f=>f.type==='application/pdf');
  const pn = parseInt(el('preview-page')?.value||'1',10) || 1;
  renderPreview(pdf || null, pn);
}

function updateFileList(){
  const list = el('file-list');
  if(!state.files.length){
    list.textContent = 'No files selected.';
    return;
  }
  list.innerHTML = state.files.map(f=>`• ${escapeHtml(f.name)} (${Math.round(f.size/1024)} KB)`).join('<br>');
}

function updateRunEnabled(){
  const runBtn = el('run');
  if(runBtn && !state.runLabel){
    state.runLabel = runBtn.textContent || 'Process';
  }
  if(!state.depsReady){
    if(runBtn){
      runBtn.disabled = true;
      runBtn.textContent = 'Loading…';
    }
    toast('Loading dependencies…');
    return;
  }
  if(runBtn){
    runBtn.textContent = state.runLabel || 'Process';
  }
  if(!state.tool){ runBtn.disabled = true; return; }
  const msg = state.tool.validate ? state.tool.validate() : '';
  runBtn.disabled = !!msg;
  if(msg) toast(msg);
  else toast('');
}
// ---------- File handling ----------
(function bindFileHandling(){
  const drop = el('dropzone');
  const input = el('file-input');
  const clearBtn = el('clear-files');

  function addFiles(files){
    for(const f of files){
      if(!state.files.find(x=>x.name===f.name && x.size===f.size)){
        state.files.push(f);
      }
    }
    updateFileList();
    updateRunEnabled();

    // auto-preview first PDF
    const pdf = state.files.find(f=>f.type==='application/pdf');
    if(pdf){
      const pn = parseInt(el('preview-page')?.value||'1',10) || 1;
      renderPreview(pdf, pn);
    }
  }

  input.addEventListener('change', e=>{
    const files = Array.from(e.target.files||[]);
    addFiles(files);
    input.value='';
  });

  clearBtn.addEventListener('click', ()=>{
    state.files = [];
    updateFileList();
    updateRunEnabled();
    el('preview-canvas').getContext('2d').clearRect(0,0,9999,9999);
    el('preview-note').textContent = 'Files cleared.';
  });

  ;['dragenter','dragover'].forEach(ev=>{
    drop.addEventListener(ev, e=>{
      e.preventDefault();
      drop.classList.add('drag');
    });
  });
  ;['dragleave','drop'].forEach(ev=>{
    drop.addEventListener(ev, e=>{
      e.preventDefault();
      drop.classList.remove('drag');
    });
  });
  drop.addEventListener('drop', e=>{
    const files = Array.from(e.dataTransfer.files||[]);
    addFiles(files);
  });
})();

// ---------- Preview controls ----------
(function bindPreviewControls(){
  const refresh = el('preview-refresh');
  const pageInp = el('preview-page');

  function doPreview(){
    const pdf = state.files.find(f=>f.type==='application/pdf');
    const pn = parseInt(pageInp.value||'1',10) || 1;
    renderPreview(pdf || null, pn);
  }

  refresh.addEventListener('click', doPreview);
  pageInp.addEventListener('change', doPreview);
})();

// ---------- Run / Reset ----------
(function bindRunReset(){
  const runBtn = el('run');
  const resetBtn = el('reset-tool');

  runBtn.addEventListener('click', async ()=>{
    if(!state.tool) return;
    try{
      toast('Processing…');
      await state.tool.run();
      toast('Done.');
    }catch(e){
      toast('Error: ' + (e?.message||e));
    }
  });

  resetBtn.addEventListener('click', ()=>{
    if(!state.tool) return;
    el('tool-options').innerHTML='';
    state.tool.buildOptions?.(el('tool-options'));
    updateRunEnabled();
    toast('Options reset.');
  });
})();

// ---------- Deep link on load ----------
(function initFromHash(){
  try{
    const h = new URL(location.href).hash;
    if(h && h.includes('tool=')){
      const id = decodeURIComponent(h.split('tool=')[1]||'');
      if(tools.find(t=>t.id===id)){
        state.toolId = id;
      }
    }
  }catch(_){}
})();

// ---------- Startup ----------
document.addEventListener('DOMContentLoaded', ()=>{
  try{
    assignToolIcons();
    buildSidebar();
    bindSidebarControls();
    bindToolSearch();

    if(state.compact){
      document.body.classList.add('compact');
    }

    // activate tool from hash or first favorite
    const firstFav = [...(state.favorites||[])][0];
    const startTool = state.toolId || firstFav || tools[0]?.id;
    if(startTool){
      setTool(startTool);
    }

    const checkDepsReady = ()=>{
      state.depsReady = !!(window.PDFLib && window.pdfjsLib);
      updateRunEnabled();
      if(!state.depsReady){
        setTimeout(checkDepsReady, 200);
      }
    };
    checkDepsReady();
  }catch(e){
    showFatalError(e?.message||e);
  }
});
// ---------- Core PDF helpers ----------
async function loadPdfBytes(file){
  return new Uint8Array(await file.arrayBuffer());
}
// ---------- Tool: Merge ----------
function simpleToolMerge(){
  return {
    id:'merge', name:'Merge PDFs', category:'Core', accept:'pdf',
    desc:'Combine multiple PDFs into a single PDF.',
    how:'Loads each PDF and appends all pages in order into one document.',
    mistakes:'Uploading non-PDF files, or password-protected PDFs can prevent merging.',
    tips:'If you have many large PDFs, merge in smaller batches first.',
    buildOptions(root){
      root.innerHTML = `
        <div class="mini">Merges all uploaded PDFs in the order shown in the file list.</div>
      `;
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length < 2) return 'Upload at least 2 PDFs to merge.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      const out = await lib.PDFDocument.create();

      for(const f of pdfs){
        const src = await lib.PDFDocument.load(await loadPdfBytes(f));
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach(p=>out.addPage(p));
      }

      const bytes = await out.save();
      await downloadOutput([{name:'merged.pdf', bytes}]);
    }
  };
}

// ---------- Tool: Extract/Split ----------
function simpleToolExtract(){
  return {
    id:'extract', name:'Split / Extract Pages', category:'Core', accept:'pdf',
    desc:'Extract specific pages from a PDF into a new PDF.',
    how:'Copies selected pages (by range) into a new document.',
    mistakes:'Page numbers are 1-based. Use "1-3,5" format. Upload exactly one PDF.',
    tips:'Use Preview to confirm page numbers before extracting.',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>Pages to extract (e.g., 1-3,5,7)</label>
          <input id="ex-pages" placeholder="1-3,5" />
        </div>
        <div class="mini">Upload exactly one PDF, then specify the pages you want.</div>
      `;
      el('ex-pages').addEventListener('input', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF to extract pages.';
      const v = String(el('ex-pages')?.value||'').trim();
      if(!v) return 'Enter page ranges to extract.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const src = await lib.PDFDocument.load(await loadPdfBytes(file));
      const max = src.getPageCount();

      const pages = parseRanges(el('ex-pages').value, max);
      if(!pages.length) throw new Error('No valid pages selected.');

      const out = await lib.PDFDocument.create();
      const indices = pages.map(p=>p-1);
      const copied = await out.copyPages(src, indices);
      copied.forEach(p=>out.addPage(p));

      const bytes = await out.save();
      const name = file.name.replace(/\.pdf$/i,'') + `-extract.pdf`;
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Reorder ----------
function simpleToolReorder(){
  return {
    id:'reorder', name:'Reorder Pages', category:'Core', accept:'pdf',
    desc:'Reorder pages by typing a new sequence (e.g., 3,1,2).',
    how:'Copies pages into a new document using your new order.',
    mistakes:'You must include each page number exactly once (1-based).',
    tips:'For large documents, start with small tests (e.g., 1-5).',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>New page order (e.g., 3,1,2,4)</label>
          <input id="ro-order" placeholder="3,1,2,4" />
          <div class="mini">Upload exactly one PDF. Order must include all pages once.</div>
        </div>
      `;
      el('ro-order').addEventListener('input', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF to reorder.';
      const v = String(el('ro-order')?.value||'').trim();
      if(!v) return 'Enter a page order like 3,1,2.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const src = await lib.PDFDocument.load(await loadPdfBytes(file));
      const max = src.getPageCount();

      const seq = String(el('ro-order').value||'')
        .split(',')
        .map(s=>parseInt(s.trim(),10))
        .filter(n=>Number.isFinite(n));

      if(seq.length !== max) throw new Error(`Order must include exactly ${max} pages.`);
      const set = new Set(seq);
      if(set.size !== max) throw new Error('Order contains duplicates.');
      if(seq.some(n=>n<1 || n>max)) throw new Error('Order contains invalid page numbers.');

      const out = await lib.PDFDocument.create();
      const indices = seq.map(n=>n-1);
      const copied = await out.copyPages(src, indices);
      copied.forEach(p=>out.addPage(p));

      const bytes = await out.save();
      const name = file.name.replace(/\.pdf$/i,'') + `-reordered.pdf`;
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Rotate ----------
function simpleToolRotate(){
  return {
    id:'rotate', name:'Rotate Pages', category:'Core', accept:'pdf',
    desc:'Rotate specific pages by 90/180/270 degrees.',
    how:'Loads the PDF and applies rotation to selected pages.',
    mistakes:'If you leave pages blank, it rotates ALL pages.',
    tips:'Try rotating only a few pages first to confirm direction.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Degrees</label>
            <select id="rt-deg">
              <option value="90">90</option>
              <option value="180">180</option>
              <option value="270">270</option>
            </select>
          </div>
          <div class="opt">
            <label>Pages (optional)</label>
            <input id="rt-pages" placeholder="(blank = all) e.g., 1-3,7" />
          </div>
        </div>
      `;
      el('rt-deg').addEventListener('change', updateRunEnabled);
      el('rt-pages').addEventListener('input', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF to rotate.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));
      const max = doc.getPageCount();
      const deg = parseInt(el('rt-deg').value,10) || 90;

      const v = String(el('rt-pages').value||'').trim();
      const pages = v ? parseRanges(v, max) : Array.from({length:max}, (_,i)=>i+1);

      pages.forEach(p=>{
        const page = doc.getPage(p-1);
        page.setRotation(lib.degrees(deg));
      });

      const bytes = await doc.save();
      const name = file.name.replace(/\.pdf$/i,'') + `-rotated.pdf`;
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Reverse ----------
function simpleToolReverse(){
  return {
    id:'reverse', name:'Reverse Pages', category:'Core', accept:'pdf',
    desc:'Reverse the page order of a PDF.',
    how:'Copies pages in reverse order into a new document.',
    mistakes:'Upload exactly one PDF.',
    tips:'Useful when scans come out backwards.',
    buildOptions(root){
      root.innerHTML = `<div class="mini">Reverses all pages in the selected PDF.</div>`;
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF to reverse.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const src = await lib.PDFDocument.load(await loadPdfBytes(file));
      const max = src.getPageCount();

      const out = await lib.PDFDocument.create();
      const indices = Array.from({length:max}, (_,i)=>max-1-i);
      const copied = await out.copyPages(src, indices);
      copied.forEach(p=>out.addPage(p));

      const bytes = await out.save();
      const name = file.name.replace(/\.pdf$/i,'') + `-reversed.pdf`;
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Odd / Even ----------
function simpleToolOddEven(){
  return {
    id:'oddeven', name:'Extract Odd / Even Pages', category:'Core', accept:'pdf',
    desc:'Extract only odd pages or only even pages.',
    how:'Copies every other page into a new document.',
    mistakes:'Odd/even is based on 1-based page numbering.',
    tips:'Helpful for duplex scanning cleanup.',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>Which pages?</label>
          <select id="oe-mode">
            <option value="odd" selected>Odd pages (1,3,5…)</option>
            <option value="even">Even pages (2,4,6…)</option>
          </select>
        </div>
      `;
      el('oe-mode').addEventListener('change', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const src = await lib.PDFDocument.load(await loadPdfBytes(file));
      const max = src.getPageCount();

      const mode = String(el('oe-mode').value||'odd');
      const indices = [];
      for(let i=0;i<max;i++){
        const p = i+1;
        if(mode==='odd' && (p%2===1)) indices.push(i);
        if(mode==='even' && (p%2===0)) indices.push(i);
      }

      const out = await lib.PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach(p=>out.addPage(p));
      const bytes = await out.save();

      const name = file.name.replace(/\.pdf$/i,'') + `-${mode}.pdf`;
      await downloadOutput([{name, bytes}]);
    }
  };
}
// ---------- Tool: Remove Blank Pages ----------
function simpleToolRemoveBlank(){
  return {
    id:'removeblank', name:'Remove Blank Pages', category:'Cleanup', accept:'pdf',
    desc:'Removes pages that appear blank (by scanning for visible text).',
    how:'Uses PDF.js to detect visible text on each page; pages with no text are removed.',
    mistakes:'If your “blank” pages contain only images, they may be kept (because they are not blank).',
    tips:'If you need true pixel blank detection, we can add image-render scanning later (slower).',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Text threshold</label>
            <input id="rb-minchars" type="number" min="0" value="1">
            <div class="mini">Pages with fewer than this many text characters are considered blank.</div>
          </div>
          <div class="opt">
            <label>Max pages to scan (0 = all)</label>
            <input id="rb-maxpages" type="number" min="0" value="0">
            <div class="mini">For huge PDFs, cap scanning for speed. Pages after the cap are preserved as-is.</div>
          </div>
        </div>
      `;
      el('rb-minchars').addEventListener('input', updateRunEnabled);
      el('rb-maxpages').addEventListener('input', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');

      // Use pdf.js to identify pages with text
      const pdf = await readPDFjs(file);
      const minChars = Math.max(0, parseInt(el('rb-minchars').value||'1',10) || 0);
      const maxCap = Math.max(0, parseInt(el('rb-maxpages').value||'0',10) || 0);
      const maxPages = maxCap ? Math.min(pdf.numPages, maxCap) : pdf.numPages;

      const keep = [];
      for(let p=1;p<=maxPages;p++){
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        const text = tc.items.map(it=>it.str).join('');
        if(text.length >= minChars) keep.push(p-1);
      }

      // If capped, keep all remaining pages by default
      for(let p=maxPages+1;p<=pdf.numPages;p++){
        keep.push(p-1);
      }

      const src = await lib.PDFDocument.load(await loadPdfBytes(file));
      const out = await lib.PDFDocument.create();
      const copied = await out.copyPages(src, keep);
      copied.forEach(pg=>out.addPage(pg));
      const bytes = await out.save();
      const name = file.name.replace(/\.pdf$/i,'') + '-noblanks.pdf';
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Page Numbering ----------
function simpleToolPageNumber(){
  return {
    id:'pagenumber', name:'Add Page Numbers', category:'Legal', accept:'pdf',
    desc:'Adds page numbers to the bottom-right of each page.',
    how:'Draws a small text label onto each page using a standard font.',
    mistakes:'If your PDF has very tight margins, numbers may overlap content.',
    tips:'Use a smaller font size or increase the margin offset.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Start number</label>
            <input id="pn-start" type="number" min="1" value="1">
          </div>
          <div class="opt">
            <label>Font size</label>
            <input id="pn-size" type="number" min="6" value="10">
          </div>
        </div>
        <div class="row2">
          <div class="opt">
            <label>Margin from bottom (pt)</label>
            <input id="pn-bottom" type="number" min="0" value="18">
          </div>
          <div class="opt">
            <label>Margin from right (pt)</label>
            <input id="pn-right" type="number" min="0" value="18">
          </div>
        </div>
        <label style="display:flex; gap:10px; align-items:center; margin-top:6px;">
          <input id="pn-prefix-toggle" type="checkbox"> Add prefix
        </label>
        <div class="opt" id="pn-prefix-wrap" style="display:none;">
          <label>Prefix text</label>
          <input id="pn-prefix" placeholder="Page ">
        </div>
      `;
      const sync = ()=>{
        el('pn-prefix-wrap').style.display = el('pn-prefix-toggle').checked ? '' : 'none';
      };
      el('pn-prefix-toggle').addEventListener('change', ()=>{ sync(); updateRunEnabled(); });
      ['pn-start','pn-size','pn-bottom','pn-right','pn-prefix'].forEach(id=>{
        el(id).addEventListener('input', updateRunEnabled);
      });
      sync();
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));
      const font = await doc.embedFont(lib.StandardFonts.Helvetica);

      const start = Math.max(1, parseInt(el('pn-start').value||'1',10) || 1);
      const size = Math.max(6, parseInt(el('pn-size').value||'10',10) || 10);
      const bottom = Math.max(0, parseInt(el('pn-bottom').value||'18',10) || 18);
      const right = Math.max(0, parseInt(el('pn-right').value||'18',10) || 18);

      const usePrefix = !!el('pn-prefix-toggle').checked;
      const prefix = usePrefix ? String(el('pn-prefix').value||'') : '';

      const pages = doc.getPages();
      pages.forEach((p, i)=>{
        const { width } = p.getSize();
        const label = prefix + String(start + i);
        const textWidth = font.widthOfTextAtSize(label, size);
        p.drawText(label, {
          x: Math.max(4, width - right - textWidth),
          y: bottom,
          size,
          font
        });
      });

      const bytes = await doc.save();
      const name = file.name.replace(/\.pdf$/i,'') + '-pagenum.pdf';
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Watermark ----------
function simpleToolWatermark(){
  return {
    id:'watermark', name:'Watermark', category:'Legal', accept:'pdf',
    desc:'Adds a watermark text on each page (diagonal or horizontal).',
    how:'Draws semi-transparent text on each page using pdf-lib.',
    mistakes:'Very large font sizes can clip. Use diagonal for most “CONFIDENTIAL” watermarks.',
    tips:'Lower opacity and use diagonal for a professional look.',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>Watermark text</label>
          <input id="wm-text" value="CONFIDENTIAL">
        </div>
        <div class="row2">
          <div class="opt">
            <label>Mode</label>
            <select id="wm-mode">
              <option value="diagonal" selected>Diagonal</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </div>
          <div class="opt">
            <label>Opacity (0.05 - 0.8)</label>
            <input id="wm-opacity" type="number" min="0.05" max="0.8" step="0.05" value="0.15">
          </div>
        </div>
        <div class="row2">
          <div class="opt">
            <label>Font size</label>
            <input id="wm-size" type="number" min="12" value="60">
          </div>
          <div class="opt">
            <label>Vertical offset (pt)</label>
            <input id="wm-yoff" type="number" value="0">
          </div>
        </div>
      `;
      ['wm-text','wm-mode','wm-opacity','wm-size','wm-yoff'].forEach(id=>{
        el(id).addEventListener('input', updateRunEnabled);
        el(id).addEventListener('change', updateRunEnabled);
      });
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      const t = String(el('wm-text').value||'').trim();
      if(!t) return 'Enter watermark text.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));
      const font = await doc.embedFont(lib.StandardFonts.HelveticaBold);

      const text = String(el('wm-text').value||'').trim();
      const mode = String(el('wm-mode').value||'diagonal');
      const opacity = Math.min(0.8, Math.max(0.05, parseFloat(el('wm-opacity').value||'0.15') || 0.15));
      const size = Math.max(12, parseInt(el('wm-size').value||'60',10) || 60);
      const yoff = parseInt(el('wm-yoff').value||'0',10) || 0;

      for(const p of doc.getPages()){
        const { width, height } = p.getSize();
        const x = width/2 - (font.widthOfTextAtSize(text, size)/2);
        const y = height/2 + yoff;

        const rotate = mode==='diagonal' ? lib.degrees(35) : lib.degrees(0);

        p.drawText(text, {
          x, y,
          size,
          font,
          rotate,
          color: lib.rgb(0,0,0),
          opacity
        });
      }

      const bytes = await doc.save();
      const name = file.name.replace(/\.pdf$/i,'') + '-watermarked.pdf';
      await downloadOutput([{name, bytes}]);
    }
  };
}

// ---------- Tool: Bates Numbering ----------
function simpleToolBates(){
  return {
    id:'bates', name:'Bates Numbering', category:'Legal', accept:'pdf',
    desc:'Adds sequential Bates numbers like CASE-00001 on each page.',
    how:'Draws a label with prefix + leading zeros at bottom-right.',
    mistakes:'If margins are tight, increase offsets. Bates is 1-based.',
    tips:'Use a prefix like CASE- and 5 digits for legal productions.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Prefix</label>
            <input id="bt-prefix" value="CASE-">
          </div>
          <div class="opt">
            <label>Start number</label>
            <input id="bt-start" type="number" min="1" value="1">
          </div>
        </div>
        <div class="row2">
          <div class="opt">
            <label>Leading zeros</label>
            <input id="bt-zeros" type="number" min="0" value="5">
          </div>
          <div class="opt">
            <label>Font size</label>
            <input id="bt-size" type="number" min="6" value="10">
          </div>
        </div>
        <div class="row2">
          <div class="opt">
            <label>Bottom margin (pt)</label>
            <input id="bt-bottom" type="number" min="0" value="18">
          </div>
          <div class="opt">
            <label>Right margin (pt)</label>
            <input id="bt-right" type="number" min="0" value="18">
          </div>
        </div>
      `;
      ['bt-prefix','bt-start','bt-zeros','bt-size','bt-bottom','bt-right'].forEach(id=>{
        el(id).addEventListener('input', updateRunEnabled);
      });
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));
      const font = await doc.embedFont(lib.StandardFonts.Helvetica);

      const prefix = String(el('bt-prefix').value||'');
      const start = Math.max(1, parseInt(el('bt-start').value||'1',10) || 1);
      const zeros = Math.max(0, parseInt(el('bt-zeros').value||'5',10) || 5);
      const size = Math.max(6, parseInt(el('bt-size').value||'10',10) || 10);
      const bottom = Math.max(0, parseInt(el('bt-bottom').value||'18',10) || 18);
      const right = Math.max(0, parseInt(el('bt-right').value||'18',10) || 18);

      doc.getPages().forEach((p, i)=>{
        const { width } = p.getSize();
        const n = String(start + i).padStart(zeros, '0');
        const label = prefix + n;
        const textWidth = font.widthOfTextAtSize(label, size);
        p.drawText(label, {
          x: Math.max(4, width - right - textWidth),
          y: bottom,
          size,
          font
        });
      });

      const bytes = await doc.save();
      const name = file.name.replace(/\.pdf$/i,'') + '-bates.pdf';
      await downloadOutput([{name, bytes}]);
    }
  };
}
// ---------- Tool: Bulk Sign ----------
function simpleToolSign(){
  // signature state (tool-level)
  const sigState = { imageBytes:null, imageType:'png', imgW:0, imgH:0 };

  async function loadImageBytes(file){
    const buf = new Uint8Array(await file.arrayBuffer());
    // compute dimensions via browser image decode
    const url = URL.createObjectURL(file);
    try{
      const img = new Image();
      await new Promise((res, rej)=>{
        img.onload = ()=>res();
        img.onerror = ()=>rej(new Error('Invalid image.'));
        img.src = url;
      });
      return { buf, w: img.naturalWidth||0, h: img.naturalHeight||0 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return {
    id:'sign', name:'Bulk Sign PDFs', category:'Security', accept:'pdf',
    desc:'Apply a signature image to one or more PDFs at the same position.',
    how:'Embeds your PNG/JPG signature and draws it on each page you choose.',
    mistakes:'Upload the signature image first. If placement looks inverted, adjust Y (PDF uses bottom-left origin).',
    tips:'Start with width ~150–220. Use “Max scale” to prevent huge images from covering the page.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Signature image (PNG/JPG)</label>
            <input id="sg-img" type="file" accept="image/png,image/jpeg">
            <div class="mini">Your signature stays local in the browser.</div>
            <div id="sg-thumb" class="mini" style="margin-top:8px;"></div>
          </div>

          <div class="opt">
            <label>Pages</label>
            <input id="sg-pages" placeholder="(blank = last page) e.g., 1,3,5 or 2-4">
            <div class="mini">Blank defaults to <b>last page</b> only.</div>
          </div>
        </div>

        <div class="row2">
          <div class="opt">
            <label>Width (pt)</label>
            <input id="sg-w" type="number" min="10" value="180">
          </div>
          <div class="opt">
            <label>Height (pt)</label>
            <input id="sg-h" type="number" min="10" value="60">
          </div>
        </div>

        <div class="row2">
          <div class="opt">
            <label>X (pt from left)</label>
            <input id="sg-x" type="number" value="360">
          </div>
          <div class="opt">
            <label>Y (pt from top)</label>
            <input id="sg-y" type="number" value="650">
            <div class="mini">Y is interpreted from the <b>top</b> (what users expect).</div>
          </div>
        </div>

        <div class="row2">
          <div class="opt">
            <label>Max scale (initial import)</label>
            <select id="sg-maxscale">
              <option value="0.20" selected>20% of page width</option>
              <option value="0.25">25%</option>
              <option value="0.33">33%</option>
              <option value="0.50">50%</option>
              <option value="1.00">No limit</option>
            </select>
            <div class="mini">Prevents a huge high-res PNG from covering the page.</div>
          </div>

          <div class="opt">
            <label>Download</label>
            <select id="sg-out">
              <option value="zip" selected>ZIP (recommended)</option>
              <option value="files">Separate PDFs</option>
            </select>
          </div>
        </div>
      `;

      const imgInp = el('sg-img');
      const thumb = el('sg-thumb');

      imgInp.addEventListener('change', async ()=>{
        const f = imgInp.files?.[0];
        if(!f){ sigState.imageBytes=null; thumb.textContent=''; updateRunEnabled(); return; }

        try{
          const { buf, w, h } = await loadImageBytes(f);
          sigState.imageBytes = buf;
          sigState.imageType = f.type.includes('jpeg') ? 'jpg' : 'png';
          sigState.imgW = w; sigState.imgH = h;

          // render thumbnail
          const u = URL.createObjectURL(f);
          thumb.innerHTML = `<div class="mini"><b>Preview:</b></div><img src="${u}" alt="signature" style="max-width:180px; max-height:90px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:rgba(0,0,0,.10);">`;

          // auto-size to maxscale if too large (based on a typical page width guess)
          // Real scaling will happen per page at run time too.
          updateRunEnabled();
        }catch(e){
          thumb.textContent = 'Could not load signature image.';
          sigState.imageBytes = null;
          updateRunEnabled();
        }
      });

      ['sg-pages','sg-w','sg-h','sg-x','sg-y','sg-maxscale','sg-out'].forEach(id=>{
        el(id).addEventListener('input', updateRunEnabled);
        el(id).addEventListener('change', updateRunEnabled);
      });
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(!pdfs.length) return 'Upload at least 1 PDF.';
      if(!sigState.imageBytes) return 'Upload a signature image (PNG/JPG).';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const pdfs = state.files.filter(f=>f.type==='application/pdf');

      const wUser = Math.max(10, parseFloat(el('sg-w').value||'180') || 180);
      const hUser = Math.max(10, parseFloat(el('sg-h').value||'60') || 60);
      const xUser = parseFloat(el('sg-x').value||'0') || 0;
      const yFromTop = parseFloat(el('sg-y').value||'0') || 0;
      const maxScale = Math.max(0.05, Math.min(1, parseFloat(el('sg-maxscale').value||'0.2') || 0.2));

      const pagesStr = String(el('sg-pages').value||'').trim();
      const outMode = String(el('sg-out').value||'zip');

      const outputs = [];

      for(const file of pdfs){
        const bytes = await loadPdfBytes(file);
        const doc = await lib.PDFDocument.load(bytes);

        // embed signature image
        const img = sigState.imageType==='jpg'
          ? await doc.embedJpg(sigState.imageBytes)
          : await doc.embedPng(sigState.imageBytes);

        const pageCount = doc.getPageCount();
        const pages = pagesStr ? parseRanges(pagesStr, pageCount) : [pageCount];

        for(const pNum of pages){
          const page = doc.getPage(pNum-1);
          const { width, height } = page.getSize();

          // enforce max scale
          let w = wUser, h = hUser;
          const maxW = width * maxScale;
          if(w > maxW){
            const ratio = maxW / w;
            w = maxW;
            h = h * ratio;
          }

          // Coordinate flip: user supplies Y from top, convert to pdf-lib Y from bottom
          const y = height - yFromTop - h;

          page.drawImage(img, { x: xUser, y, width: w, height: h });
        }

        const outBytes = await doc.save();
        const outName = file.name.replace(/\.pdf$/i,'') + '-signed.pdf';
        outputs.push({ name: outName, bytes: outBytes });
      }

      if(outputs.length > 1 && outMode === 'zip'){
        await downloadAsZip(outputs, 'signed-pdfs.zip');
      }else{
        await downloadOutput(outputs);
      }
    }
  };
}

// ---------- Tool: Redact (box list) ----------
function simpleToolRedact(){
  return {
    id:'redact', name:'Redact', category:'Security', accept:'pdf',
    desc:'Applies black-box redactions to specified page regions.',
    how:'Draws opaque rectangles over selected coordinates.',
    mistakes:'Coordinates are in PDF points. If you need click-to-draw redaction, we can add that next.',
    tips:'Use Preview + trial-and-error to find approximate coordinates quickly.',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>Redaction boxes (one per line)</label>
          <textarea id="rd-boxes" class="ta" rows="6" placeholder="page,x,y,width,height&#10;1,60,120,200,18&#10;2,50,500,300,30"></textarea>
          <div class="mini">Coordinates are in <b>PDF points</b> from bottom-left (x,y). Page is 1-based.</div>
        </div>
      `;
      el('rd-boxes').addEventListener('input', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      const lines = String(el('rd-boxes').value||'').trim();
      if(!lines) return 'Enter at least one redaction box.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));

      const raw = String(el('rd-boxes').value||'').trim();
      const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

      // allow header row
      const parsed = [];
      for(const line of lines){
        if(line.toLowerCase().startsWith('page,')) continue;
        const parts = line.split(',').map(x=>x.trim());
        if(parts.length < 5) continue;
        const p = parseInt(parts[0],10);
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const w = parseFloat(parts[3]);
        const h = parseFloat(parts[4]);
        if([p,x,y,w,h].some(v=>!Number.isFinite(v))) continue;
        parsed.push({p,x,y,w,h});
      }
      if(!parsed.length) throw new Error('No valid redaction rows found.');

      for(const r of parsed){
        if(r.p < 1 || r.p > doc.getPageCount()) continue;
        const page = doc.getPage(r.p - 1);
        page.drawRectangle({
          x: r.x, y: r.y,
          width: r.w, height: r.h,
          color: lib.rgb(0,0,0),
          opacity: 1
        });
      }

      const outBytes = await doc.save();
      const name = file.name.replace(/\.pdf$/i,'') + '-redacted.pdf';
      await downloadOutput([{name, bytes: outBytes}]);
    }
  };
}

// ---------- Tool: PII Scan ----------
function simpleToolPIIScan(){
  return {
    id:'piiscan', name:'PII Scan', category:'Security', accept:'pdf',
    desc:'Scans text for emails, phone numbers, SSNs, and credit card patterns.',
    how:'Extracts text from first pages (PDF.js) and runs pattern matching locally.',
    mistakes:'If the PDF is scanned (image-only), text extraction may find nothing.',
    tips:'For scanned PDFs, run OCR first (future enhancement) or use a searchable PDF.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Max pages to scan</label>
            <input id="pii-pages" type="number" min="1" value="3">
          </div>
          <div class="opt">
            <label>Output</label>
            <select id="pii-format">
              <option value="text" selected>Text report</option>
              <option value="json">JSON</option>
            </select>
          </div>
        </div>

        <button id="pii-copy" class="btn btn-sm" type="button" style="margin-top:10px;">Copy results to clipboard</button>
        <div class="mini" style="margin-top:10px;">Results will appear in the Output panel.</div>
      `;

      el('pii-pages').addEventListener('input', updateRunEnabled);
      el('pii-format').addEventListener('change', updateRunEnabled);

      el('pii-copy').addEventListener('click', async ()=>{
        const txt = el('output').textContent || '';
        try{
          await navigator.clipboard.writeText(txt);
          toast('Copied results to clipboard.');
        }catch(_){
          toast('Copy failed (browser blocked clipboard).');
        }
      });
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const file = state.files.find(f=>f.type==='application/pdf');
      const pdf = await readPDFjs(file);
      const maxPages = Math.min(pdf.numPages, Math.max(1, parseInt(el('pii-pages').value||'3',10)||3));
      let text = '';
      for(let p=1;p<=maxPages;p++){
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        text += tc.items.map(it=>it.str).join(' ') + '\n';
      }

      // Patterns
      const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const phoneRe = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
      const ssnRe = /\b\d{3}-\d{2}-\d{4}\b/g;
      const ccRe = /\b(?:\d[ -]*?){13,19}\b/g;

      function uniq(arr){
        const s = new Set(arr||[]);
        return Array.from(s).slice(0, 500);
      }

      const emails = uniq(text.match(emailRe)||[]);
      const phones = uniq(text.match(phoneRe)||[]);
      const ssns = uniq(text.match(ssnRe)||[]);
      // Filter CC candidates by Luhn check
      const ccCandidates = uniq(text.match(ccRe)||[]);
      const cards = ccCandidates.filter(x=>{
        const digits = x.replace(/\D/g,'');
        if(digits.length<13 || digits.length>19) return false;
        return luhn(digits);
      }).map(x=>x.replace(/\s+/g,' ').trim());

      const report = { scannedPages:maxPages, emails, phones, ssns, cards };

      const fmt = String(el('pii-format').value||'text');
      if(fmt === 'json'){
        toast(JSON.stringify(report, null, 2));
        return;
      }

      let out = `PII Scan Report (pages scanned: ${maxPages})\n\n`;
      out += `Emails (${emails.length}):\n` + (emails.join('\n')||'(none)') + '\n\n';
      out += `Phones (${phones.length}):\n` + (phones.join('\n')||'(none)') + '\n\n';
      out += `SSNs (${ssns.length}):\n` + (ssns.join('\n')||'(none)') + '\n\n';
      out += `Credit Cards (${cards.length}):\n` + (cards.join('\n')||'(none)') + '\n';
      toast(out);
    }
  };

  function luhn(digits){
    let sum = 0, alt = false;
    for(let i=digits.length-1;i>=0;i--){
      let n = parseInt(digits[i],10);
      if(alt){
        n *= 2;
        if(n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return (sum % 10) === 0;
  }
}

// ---------- Tool: Metadata Editor ----------
function simpleToolMetadata(){
  return {
    id:'metadata', name:'Metadata Editor', category:'Security', accept:'pdf',
    desc:'View/edit PDF metadata (Title, Author, Subject, Keywords, Producer, Creator).',
    how:'Reads and updates common document metadata fields using pdf-lib.',
    mistakes:'Some PDFs may have restricted metadata or nonstandard fields.',
    tips:'Clearing Producer/Creator can improve privacy by hiding the generating software.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt"><label>Title</label><input id="md-title" placeholder="(optional)"></div>
          <div class="opt"><label>Author</label><input id="md-author" placeholder="(optional)"></div>
        </div>
        <div class="row2">
          <div class="opt"><label>Subject</label><input id="md-subject" placeholder="(optional)"></div>
          <div class="opt"><label>Keywords</label><input id="md-keywords" placeholder="(comma-separated)"></div>
        </div>
        <div class="row2">
          <div class="opt"><label>Producer</label><input id="md-producer" placeholder="(optional)"></div>
          <div class="opt"><label>Creator</label><input id="md-creator" placeholder="(optional)"></div>
        </div>
        <label style="display:flex; gap:10px; align-items:center; margin-top:6px;">
          <input id="md-clear" type="checkbox"> Clear all fields (privacy)
        </label>
        <button id="md-load" class="btn btn-sm" type="button" style="margin-top:10px;">Load current metadata</button>
        <div class="mini" style="margin-top:10px;">Use “Load” to pull existing values into the form before editing.</div>
      `;

      el('md-load').addEventListener('click', async ()=>{
        try{
          const lib = getPDFLib();
          const file = state.files.find(f=>f.type==='application/pdf');
          if(!file) { toast('Upload 1 PDF first.'); return; }
          const doc = await lib.PDFDocument.load(await loadPdfBytes(file));
          el('md-title').value = doc.getTitle() || '';
          el('md-author').value = doc.getAuthor() || '';
          el('md-subject').value = doc.getSubject() || '';
          el('md-keywords').value = (doc.getKeywords && doc.getKeywords()) ? doc.getKeywords() : '';
          // pdf-lib doesn't expose producer/creator getters reliably across versions
          // We'll still allow setting them.
          toast('Loaded basic metadata. You can edit and Process to save.');
        }catch(e){
          toast('Load failed: ' + (e?.message||e));
        }
      });

      ['md-title','md-author','md-subject','md-keywords','md-producer','md-creator','md-clear']
        .forEach(id=>{
          el(id).addEventListener('input', updateRunEnabled);
          el(id).addEventListener('change', updateRunEnabled);
        });
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));

      const clearAll = !!el('md-clear').checked;
      const setOrClear = (setter, val)=>{
        try{
          if(clearAll || !String(val||'').trim()) setter('');
          else setter(String(val));
        }catch(_){}
      };

      setOrClear(v=>doc.setTitle(v), el('md-title').value);
      setOrClear(v=>doc.setAuthor(v), el('md-author').value);
      setOrClear(v=>doc.setSubject(v), el('md-subject').value);
      try{
        if(clearAll) doc.setKeywords([]);
        else{
          const kws = String(el('md-keywords').value||'').split(',').map(s=>s.trim()).filter(Boolean);
          doc.setKeywords(kws);
        }
      }catch(_){}

      // Producer / Creator: pdf-lib has setters in newer versions
      try{
        if(doc.setProducer) setOrClear(v=>doc.setProducer(v), el('md-producer').value);
      }catch(_){}
      try{
        if(doc.setCreator) setOrClear(v=>doc.setCreator(v), el('md-creator').value);
      }catch(_){}

      const outBytes = await doc.save();
      const name = file.name.replace(/\.pdf$/i,'') + '-metadata.pdf';
      await downloadOutput([{name, bytes: outBytes}]);
    }
  };
}
// ---------- Tool: Audit ----------
function simpleToolAudit(){
  return {
    id:'audit', name:'Audit / Inspect', category:'Analyze', accept:'pdf',
    desc:'Shows page count, basic metadata, and form field names (if any).',
    how:'Loads the PDF with pdf-lib and inspects document + AcroForm fields.',
    mistakes:'Scanned PDFs may have no text or fields; that’s normal.',
    tips:'Use the field name list as input for Form Fill (JSON/CSV keys).',
    buildOptions(root){
      root.innerHTML = `
        <div class="mini">Press Process to generate an audit report in the Output panel.</div>
      `;
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file), { ignoreEncryption: false });

      const info = {
        filename: file.name,
        pages: doc.getPageCount(),
        title: doc.getTitle?.() || '',
        author: doc.getAuthor?.() || '',
        subject: doc.getSubject?.() || '',
        keywords: (doc.getKeywords?.() || []).join(', '),
        creator: '',
        producer: '',
        formFields: []
      };

      // Producer/Creator not always readable in pdf-lib; keep placeholders.
      try{
        const form = doc.getForm();
        const fields = form.getFields();
        info.formFields = fields.map(f=>{
          try{ return f.getName(); }catch(_){ return '(unknown)'; }
        });
      }catch(_){
        info.formFields = [];
      }

      let out = `PDF Audit Report\n\n`;
      out += `File: ${info.filename}\n`;
      out += `Pages: ${info.pages}\n\n`;
      out += `Title: ${info.title || '(none)'}\n`;
      out += `Author: ${info.author || '(none)'}\n`;
      out += `Subject: ${info.subject || '(none)'}\n`;
      out += `Keywords: ${info.keywords || '(none)'}\n\n`;
      out += `Form Fields (${info.formFields.length}):\n`;
      out += info.formFields.length ? info.formFields.map(x=>`- ${x}`).join('\n') : '(none)';
      toast(out);
    }
  };
}

// ---------- Tool: Compress (safe optimize) ----------
function simpleToolCompress(){
  return {
    id:'compress', name:'Compress / Optimize', category:'Optimize', accept:'pdf',
    desc:'Re-saves the PDF in a cleaner form. (Safe optimization, not aggressive recompression.)',
    how:'Loads and re-saves via pdf-lib which can remove some cruft and normalize structure.',
    mistakes:'This does not aggressively recompress images. For heavy compression, we can add raster downscaling.',
    tips:'If your PDF is image-heavy, consider a future “Downscale Images” advanced mode.',
    buildOptions(root){
      root.innerHTML = `
        <div class="mini">
          This tool performs a <b>safe optimize</b> by re-saving the PDF.
          It may reduce size slightly for some PDFs.
        </div>
      `;
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file));
      const outBytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
      const name = file.name.replace(/\.pdf$/i,'') + '-optimized.pdf';
      await downloadOutput([{name, bytes: outBytes}]);
    }
  };
}

// ---------- Tool: Repair (sanitize) ----------
function simpleToolRepair(){
  return {
    id:'repair', name:'Repair / Re-save', category:'Optimize', accept:'pdf',
    desc:'Attempts to repair broken PDFs by loading and re-saving them.',
    how:'Loads via pdf-lib and writes a fresh, normalized PDF.',
    mistakes:'If a PDF is encrypted or severely corrupted, repair may fail.',
    tips:'If repair fails, try opening/saving the PDF in another viewer first.',
    buildOptions(root){
      root.innerHTML = `<div class="mini">Upload one PDF and click Process.</div>`;
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files.find(f=>f.type==='application/pdf');
      const doc = await lib.PDFDocument.load(await loadPdfBytes(file), { ignoreEncryption: false });
      const outBytes = await doc.save({ useObjectStreams: true });
      const name = file.name.replace(/\.pdf$/i,'') + '-repaired.pdf';
      await downloadOutput([{name, bytes: outBytes}]);
    }
  };
}

// ---------- Tool: Validate ----------
function simpleToolValidate(){
  return {
    id:'validate', name:'Validate PDF', category:'Analyze', accept:'pdf',
    desc:'Performs basic checks: loads PDF, counts pages, reports if encrypted.',
    how:'Attempts to load with pdf-lib and reports key properties.',
    mistakes:'If your PDF is encrypted, tools may not work without password removal.',
    tips:'Use Unlock (future) if you need password removal (not included yet).',
    buildOptions(root){
      root.innerHTML = `<div class="mini">Press Process to validate the PDF.</div>`;
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const file = state.files.find(f=>f.type==='application/pdf');
      try{
        const lib = getPDFLib();
        const bytes = await loadPdfBytes(file);
        const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: false });
        const pages = doc.getPageCount();
        toast(`Validation OK\n\nFile: ${file.name}\nPages: ${pages}\nEncrypted: (unknown via pdf-lib)\n`);
      }catch(e){
        toast(`Validation failed\n\nFile: ${file.name}\nError: ${e?.message||e}\n`);
      }
    }
  };
}

// ---------- Tool: Categorize (completed) ----------
function simpleToolCategorizeStub(){
  return {
    id:'categorize', name:'Categorize PDFs', category:'Advanced',
    desc:'Generates a CSV report with suggested categories using filename + first-page text hints.',
    how:'Scans filenames and (optionally) extracted text, then applies keyword rules.',
    mistakes:'If you set scan chars to 0, categorization is filename-only.',
    tips:'Put your most specific rules first; first match wins.',
    accept:'pdf',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>Category rules (one per line)</label>
          <textarea id="cat-rules" class="ta" rows="6" placeholder="Invoice=invoice,bill&#10;Statement=statement&#10;Contract=contract,agreement&#10;Receipt=receipt"></textarea>
          <div class="mini">Rules are case-insensitive. First matching rule wins.</div>
        </div>
        <div class="row2">
          <div class="opt">
            <label>Text scan (characters)</label>
            <input id="cat-scan" type="number" min="0" value="2500">
            <div class="mini">0 = filename-only</div>
          </div>
          <div class="opt">
            <label>Output</label>
            <select id="cat-format">
              <option value="csv" selected>CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
        </div>
      `;
      el('cat-rules')?.addEventListener('input', updateRunEnabled);
      el('cat-scan')?.addEventListener('input', updateRunEnabled);
      el('cat-format')?.addEventListener('change', updateRunEnabled);
    },
    validate(){
      if(!state.files.length) return 'Upload 1+ PDFs.';
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(!pdfs.length) return 'Upload at least 1 PDF.';
      return '';
    },
    async run(){
      const scanN = Math.max(0, parseInt(el('cat-scan')?.value||'2500',10) || 0);
      const fmt = String(el('cat-format')?.value||'csv');
      const raw = String(el('cat-rules')?.value||'').trim();

      const rules = [];
      raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach(line=>{
        const idx = line.indexOf('=');
        if(idx<0) return;
        const cat = line.slice(0,idx).trim();
        const kws = line.slice(idx+1).split(',').map(x=>x.trim()).filter(Boolean);
        if(cat && kws.length) rules.push({cat, kws});
      });

      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      const out = [];

      for(const file of pdfs){
        const name = file.name || 'file.pdf';
        const nameLc = name.toLowerCase();
        let textLc = '';
        let textErr = '';
        if(scanN>0){
          try{
            const txt = await extractTextFromPDF(file);
            textLc = (txt||'').slice(0, scanN).toLowerCase();
          }catch(e){
            textErr = e?.message || String(e);
          }
        }

        let category = 'Unknown';
        let reason = 'No match';
        let source = 'none';

        const hay = nameLc + '\n' + textLc;
        for(const r of rules){
          for(const kw of r.kws){
            const k = kw.toLowerCase();
            if(!k) continue;
            if(hay.includes(k)){
              category = r.cat;
              reason = `Matched keyword: ${kw}`;
              source = nameLc.includes(k) ? 'filename' : 'text';
              break;
            }
          }
          if(category !== 'Unknown') break;
        }

        out.push({
          filename: name,
          category,
          matchedIn: source,
          reason,
          textScanChars: scanN,
          textScanError: textErr
        });
      }

      if(fmt === 'json'){
        const bytes = new TextEncoder().encode(JSON.stringify(out, null, 2));
        // json as text download via blob
        const blob = new Blob([bytes], {type:'application/json'});
        if(window.saveAs) window.saveAs(blob, 'pdf-categorize-report.json');
        else{
          const a=document.createElement('a');
          a.href=URL.createObjectURL(blob);
          a.download='pdf-categorize-report.json';
          document.body.appendChild(a);
          a.click();
          setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},250);
        }
        return;
      }

      let csv = '';
      if(window.Papa && Papa.unparse){
        csv = Papa.unparse(out);
      }else{
        const cols = Object.keys(out[0]||{filename:'',category:'',matchedIn:'',reason:'',textScanChars:'',textScanError:''});
        const esc = (v)=>`"${String(v??'').replace(/"/g,'""')}"`;
        csv = cols.join(',') + '\n' + out.map(r=>cols.map(c=>esc(r[c])).join(',')).join('\n');
      }
      const bytes = new TextEncoder().encode(csv);
      const blob = new Blob([bytes], {type:'text/csv'});
      if(window.saveAs) window.saveAs(blob, 'pdf-categorize-report.csv');
      else{
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download='pdf-categorize-report.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},250);
      }
    }
  };
}

// ---------- Tool: Form Fill (completed) ----------
function simpleToolFormFillStub(){
  return {
    id:'formfill', name:'Form Fill', category:'Advanced',
    desc:'Fills AcroForm fields using JSON (single) or CSV (batch).',
    how:'Loads the PDF template, fills fields by name, optionally flattens, and downloads the result(s).',
    mistakes:'Works only on fillable PDFs (AcroForm). Column headers / JSON keys must match field names exactly.',
    tips:'Use Audit first to list field names. For batch, use ZIP output.',
    accept:'pdf',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Mode</label>
            <select id="ff-mode">
              <option value="json" selected>Single (JSON map)</option>
              <option value="csv">Batch (CSV rows)</option>
            </select>
          </div>
          <div class="opt">
            <label>Output</label>
            <select id="ff-out">
              <option value="zip" selected>ZIP (recommended for batch)</option>
              <option value="files">Separate files</option>
            </select>
          </div>
        </div>

        <div class="opt" id="ff-json-wrap">
          <label>Field map (JSON)</label>
          <textarea id="ff-json" class="ta" rows="7" placeholder='{"FirstName":"Eli","LastName":"Baraka","Amount":"123.45"}'></textarea>
          <div class="mini">Keys must match the PDF field names exactly.</div>
        </div>

        <div class="opt" id="ff-csv-wrap" style="display:none;">
          <label>CSV file (first row = column headers)</label>
          <input id="ff-csv" type="file" accept=".csv,text/csv">
          <div class="mini">Each row becomes a filled PDF.</div>
        </div>

        <label style="display:flex; gap:10px; align-items:center; margin-top:6px;">
          <input id="ff-flatten" type="checkbox" checked> Flatten fields after fill
        </label>

        <div class="mini" style="margin-top:8px;">
          Upload exactly <b>one</b> fillable PDF template, then fill it with JSON or batch-fill via CSV.
        </div>
      `;

      const mode = el('ff-mode');
      const jsonWrap = el('ff-json-wrap');
      const csvWrap = el('ff-csv-wrap');

      const sync = ()=>{
        const m = String(mode?.value||'json');
        jsonWrap.style.display = (m==='json') ? '' : 'none';
        csvWrap.style.display = (m==='csv') ? '' : 'none';
        updateRunEnabled();
      };

      mode?.addEventListener('change', sync);
      el('ff-json')?.addEventListener('input', updateRunEnabled);
      el('ff-csv')?.addEventListener('change', updateRunEnabled);
      el('ff-out')?.addEventListener('change', updateRunEnabled);
      el('ff-flatten')?.addEventListener('change', updateRunEnabled);
      sync();
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length!==1) return 'Upload exactly 1 fillable PDF template.';
      const mode = String(el('ff-mode')?.value||'json');
      if(mode==='json'){
        const raw = String(el('ff-json')?.value||'').trim();
        if(!raw) return 'Paste a JSON field map.';
        try{ JSON.parse(raw); }catch(_){ return 'Invalid JSON.'; }
      }else{
        const f = el('ff-csv')?.files?.[0];
        if(!f) return 'Upload a CSV file.';
      }
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const file = state.files[0];
      const bytes = await loadPdfBytes(file);
      const flatten = !!el('ff-flatten')?.checked;
      const mode = String(el('ff-mode')?.value||'json');
      const outMode = String(el('ff-out')?.value||'zip');

      const fillOne = async (map, outName)=>{
        const doc = await lib.PDFDocument.load(bytes);
        const form = doc.getForm();
        for(const [k,v] of Object.entries(map||{})){
          try{
            const field = form.getField(String(k));
            if(field.setText) field.setText(String(v ?? ''));
            else if(field.select) field.select(String(v ?? ''));
            else if(field.check && (v===true || v==='true' || v===1 || v==='1')) field.check();
            else if(field.uncheck && (v===false || v==='false' || v===0 || v==='0')) field.uncheck();
          }catch(_){}
        }
        if(flatten) form.flatten();
        const outBytes = await doc.save();
        return { name: outName, bytes: outBytes };
      };

      if(mode==='json'){
        const map = JSON.parse(String(el('ff-json')?.value||'{}'));
        const out = await fillOne(map, file.name.replace(/\.pdf$/i,'')+'-filled.pdf');
        await downloadOutput([out]);
        return;
      }

      const csvFile = el('ff-csv')?.files?.[0];
      const csvText = await csvFile.text();
      let rows = [];
      if(window.Papa && Papa.parse){
        const parsed = Papa.parse(csvText, {header:true, skipEmptyLines:true});
        rows = parsed.data || [];
      }else{
        const lines = csvText.split(/\r?\n/).filter(Boolean);
        const header = (lines.shift()||'').split(',').map(s=>s.trim());
        rows = lines.map(line=>{
          const parts = line.split(',');
          const obj = {};
          header.forEach((h,i)=>obj[h]=parts[i] ?? '');
          return obj;
        });
      }

      if(!rows.length) throw new Error('CSV has no data rows.');

      const outputs = [];
      for(let i=0;i<rows.length;i++){
        const map = rows[i] || {};
        const suffix = String(map.__name || map.filename || map.name || '').trim();
        const base = file.name.replace(/\.pdf$/i,'');
        const outName = suffix ? `${base}-${suffix}.pdf` : `${base}-row${String(i+1).padStart(3,'0')}.pdf`;
        outputs.push(await fillOne(map, outName));
      }

      if(outputs.length > 1 && outMode === 'zip'){
        await downloadAsZip(outputs, (file.name.replace(/\.pdf$/i,'')||'formfill') + '-batch.zip');
      }else{
        await downloadOutput(outputs);
      }
    }
  };
}
// ---------- Tool: Images to PDF ----------
function simpleToolImagesToPDF(){
  return {
    id:'imagestopdf', name:'Images → PDF', category:'Convert', accept:'images',
    desc:'Combine images into a single PDF (one image per page).',
    how:'Embeds PNG/JPG images using pdf-lib and makes pages sized to fit.',
    mistakes:'Upload only images (PNG/JPG). PDFs will be ignored.',
    tips:'If you need fixed page size (Letter/A4), we can add that option later.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Fit mode</label>
            <select id="im-fit">
              <option value="contain" selected>Contain (no crop)</option>
              <option value="cover">Cover (crop to fill)</option>
            </select>
          </div>
          <div class="opt">
            <label>Background</label>
            <select id="im-bg">
              <option value="white" selected>White</option>
              <option value="black">Black</option>
            </select>
          </div>
        </div>
        <div class="mini" style="margin-top:8px;">Upload images using the Files panel, then Process.</div>
      `;
      el('im-fit').addEventListener('change', updateRunEnabled);
      el('im-bg').addEventListener('change', updateRunEnabled);
    },
    validate(){
      const imgs = state.files.filter(f=>f.type.startsWith('image/'));
      if(!imgs.length) return 'Upload at least 1 image (PNG/JPG).';
      return '';
    },
    async run(){
      const lib = getPDFLib();
      const imgs = state.files.filter(f=>f.type.startsWith('image/'));
      const fit = String(el('im-fit').value||'contain');
      const bg = String(el('im-bg').value||'white');

      const doc = await lib.PDFDocument.create();

      for(const f of imgs){
        const bytes = new Uint8Array(await f.arrayBuffer());
        const isJpg = f.type.includes('jpeg') || f.type.includes('jpg');
        const img = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);

        const iw = img.width;
        const ih = img.height;

        // Create a page roughly matching image aspect ratio in points
        const pageW = 612; // 8.5in * 72
        const pageH = pageW * (ih / iw);

        const page = doc.addPage([pageW, pageH]);

        // background
        page.drawRectangle({
          x:0, y:0, width:pageW, height:pageH,
          color: bg==='black' ? lib.rgb(0,0,0) : lib.rgb(1,1,1),
          opacity: 1
        });

        // Fit
        const scaleX = pageW / iw;
        const scaleY = pageH / ih;
        const scale = (fit==='cover') ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

        const drawW = iw * scale;
        const drawH = ih * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;

        page.drawImage(img, { x, y, width: drawW, height: drawH });
      }

      const outBytes = await doc.save();
      await downloadOutput([{name:'images.pdf', bytes: outBytes}]);
    }
  };
}

// ---------- Tool: PDF to PNG ----------
function simpleToolPDFToPNG(){
  return {
    id:'topng', name:'PDF → PNG', category:'Convert', accept:'pdf',
    desc:'Renders a chosen page to a PNG image using PDF.js.',
    how:'Uses PDF.js to render the page to a canvas, then exports PNG.',
    mistakes:'If PDF.js worker is blocked, preview/export may fail. Ensure workerSrc loads.',
    tips:'Increase scale for higher resolution, but it will be slower.',
    buildOptions(root){
      root.innerHTML = `
        <div class="row2">
          <div class="opt">
            <label>Page</label>
            <input id="png-page" type="number" min="1" value="1">
          </div>
          <div class="opt">
            <label>Scale</label>
            <input id="png-scale" type="number" min="0.5" step="0.25" value="2">
          </div>
        </div>
        <div class="mini" style="margin-top:8px;">Exports a PNG of the selected page.</div>
      `;
      el('png-page').addEventListener('input', updateRunEnabled);
      el('png-scale').addEventListener('input', updateRunEnabled);
    },
    validate(){
      const pdfs = state.files.filter(f=>f.type==='application/pdf');
      if(pdfs.length !== 1) return 'Upload exactly 1 PDF.';
      return '';
    },
    async run(){
      const file = state.files.find(f=>f.type==='application/pdf');
      const pdf = await readPDFjs(file);

      const pageNum = Math.min(Math.max(1, parseInt(el('png-page').value||'1',10)||1), pdf.numPages);
      const scale = Math.max(0.5, parseFloat(el('png-scale').value||'2')||2);

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const task = page.render({ canvasContext: ctx, viewport });
      await task.promise;

      const blob = await new Promise(res=>canvas.toBlob(res, 'image/png'));
      if(!blob){
        toast('Failed to export PNG (browser could not create image).');
        return;
      }
      const outName = file.name.replace(/\.pdf$/i,'') + `-p${pageNum}.png`;
      if(window.saveAs){
        window.saveAs(blob, outName);
      }else{
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=outName;
        document.body.appendChild(a);
        a.click();
        setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},250);
      }
      toast(`Exported page ${pageNum} as PNG.`);
    }
  };
}

// ---------- Tool: HTML to PDF ----------
function simpleToolHTMLToPDF(){
  return {
    id:'html2pdf', name:'HTML → PDF', category:'Convert', accept:'mixed',
    desc:'Convert a snippet of HTML into a PDF using html2pdf.js.',
    how:'Renders HTML content into a PDF locally in the browser.',
    mistakes:'Complex CSS may not render perfectly. Use simple layouts for best results.',
    tips:'For documents, prefer clean HTML with standard fonts and spacing.',
    buildOptions(root){
      root.innerHTML = `
        <div class="opt">
          <label>HTML content</label>
          <textarea id="hp-html" class="ta" rows="10" placeholder="<h1>My PDF</h1><p>Hello!</p>"></textarea>
        </div>
        <div class="row2">
          <div class="opt">
            <label>Filename</label>
            <input id="hp-name" value="html.pdf">
          </div>
          <div class="opt">
            <label>Page size</label>
            <select id="hp-size">
              <option value="letter" selected>Letter</option>
              <option value="a4">A4</option>
            </select>
          </div>
        </div>
        <div class="mini" style="margin-top:8px;">Generates a PDF and downloads it.</div>
      `;
      el('hp-html').addEventListener('input', updateRunEnabled);
      el('hp-name').addEventListener('input', updateRunEnabled);
      el('hp-size').addEventListener('change', updateRunEnabled);
    },
    validate(){
      const html = String(el('hp-html').value||'').trim();
      if(!html) return 'Enter some HTML.';
      if(!window.html2pdf) return 'html2pdf.js not loaded.';
      return '';
    },
    async run(){
      const html = String(el('hp-html').value||'').trim();
      const name = String(el('hp-name').value||'html.pdf').trim() || 'html.pdf';
      const size = String(el('hp-size').value||'letter');

      const holder = document.createElement('div');
      holder.style.padding = '18px';
      holder.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
      holder.innerHTML = html;

      const opt = {
        margin:       0.5,
        filename:     name.endsWith('.pdf') ? name : (name + '.pdf'),
        image:        { type: 'jpeg', quality: 0.95 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: size, orientation: 'portrait' }
      };

      toast('Rendering HTML to PDF…');
      await window.html2pdf().set(opt).from(holder).save();
      toast('Done.');
    }
  };
}
