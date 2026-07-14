/* core.js — logika bersama "Cetak Draft Pesanan".
   SATU-SATUNYA tempat aturan parsing & format berada. Dipakai oleh:
     - index.html di PC   (disajikan bridge.py, cetak lewat COM/antrean Windows)
     - index.html di iPhone (GitHub Pages + Bluefy, cetak lewat Bluetooth LE)
   Ubah aturan di sini sekali -> kedua versi ikut berubah. */
"use strict";

const CORE_VERSION = "1";
const COLS = 31, FEED_LINES = 4, LEFT_MARGIN_DOTS = 12;

const UNITS = new Set(["btg","btng","batang","bh","buah","bj","biji","lbr","lembar",
 "lmbr","sak","zak","kg","ons","gr","gram","ltr","lt","liter","gln","galon","m","mtr",
 "meter","m2","m3","kubik","kbk","roll","rol","dus","box","pcs","pc","pak","pack",
 "ikat","keping","kaleng","klg","set","unit","pasang","psg","btl","botol","ember",
 "drum","karung","krg","lusin","kodi","rim","papan"]);

const QTY_RE=/^\d+(?:[.,\/]\d+)?$/, UNIT_RE=/^[A-Za-z]{1,8}$/,
 GLUED_RE=/^(\d+(?:[.,\/]\d+)?)([A-Za-z][A-Za-z0-9]{0,7})$/,
 NOTE_RE=/\(\s*([^()]*?)\s*\)\s*$/,
 LIST_PREFIX_RE=/^\d{1,2}\s*[.)]+\s*(?=[^\d\s])/,
 COMMA_PREFIX_RE=/^\d{1,2},(?=[A-Za-z])/,
 EQ_QTY_RE=/^(.+?)\s*=\s*(\d+(?:[.,\/]\d+)?)$/,
 QTY_FIRST_RE=/^(\d+(?:[.,\/]\d+)?)\s*([A-Za-z][A-Za-z0-9]{0,7})\s+(.+)$/;

const norm = s => s.trim().split(/\s+/).join(" ");

function cleanItem(item){
  item = item.replace(/\s*\.{2,}\s*/g," ").replace(/(^|\s)\.+(?=[A-Za-z0-9])/g,"$1");
  item = item.replace(/^[\s.,\-_]+|[\s.,\-_]+$/g,"");
  return norm(item);
}
function tryQtyFirst(s){
  const m = s.match(QTY_FIRST_RE);
  if (m && UNITS.has(m[2].toLowerCase())) return [m[3], m[1], m[2]];
  return null;
}
function tryQtyLast(s){
  const t = s.split(/\s+/).filter(Boolean);
  if (t.length>=3 && QTY_RE.test(t[t.length-2]) && UNIT_RE.test(t[t.length-1]))
    return [t.slice(0,-2).join(" "), t[t.length-2], t[t.length-1]];
  if (t.length>=2){
    const m = t[t.length-1].match(GLUED_RE);
    if (m && (/^[A-Za-z]+$/.test(m[2]) || UNITS.has(m[2].toLowerCase())))
      return [t.slice(0,-1).join(" "), m[1], m[2]];
  }
  return null;
}
function parseLine(line, expectedNo){
  let s = norm(line), note = null;
  const nm = s.match(NOTE_RE);
  if (nm){ note = nm[1]; s = s.slice(0, nm.index).trim(); }
  s = s.replace(LIST_PREFIX_RE,"").replace(COMMA_PREFIX_RE,"");
  if (expectedNo != null){
    const g = s.match(/^(\d{1,2})(?=[A-Za-z])/);
    if (g && parseInt(g[1]) === expectedNo) s = s.slice(g[1].length);
  }
  let parsed = tryQtyFirst(s);
  if (!parsed && expectedNo != null){
    const t = s.split(/\s+/).filter(Boolean);
    if (t.length>=2 && /^\d+$/.test(t[0]) && parseInt(t[0])===expectedNo && !tryQtyFirst(s)){
      const rest = t.slice(1).join(" ");
      if (EQ_QTY_RE.test(rest) || tryQtyLast(rest) || tryQtyFirst(rest)){
        s = rest; parsed = tryQtyFirst(s);
      }
    }
  }
  if (!parsed){ const m = s.match(EQ_QTY_RE); if (m) parsed = [m[1], m[2], ""]; }
  if (!parsed) parsed = tryQtyLast(s);
  let [item, qty, unit] = parsed || [s, null, null];
  item = cleanItem(item);
  if (note) item = (item + " (" + note + ")").trim();
  return [item, qty, unit];
}
function wrapWords(text, width){
  const words = text.split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (let w of words){
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += " " + w;
    else { lines.push(cur); cur = w; }
    while (cur.length > width){ lines.push(cur.slice(0,width)); cur = cur.slice(width); }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function pad2(n){ return String(n).padStart(2,"0"); }
function headerLines(now, cols){
  const stamp = `${pad2(now.getDate())}/${pad2(now.getMonth()+1)}/${now.getFullYear()} ` +
                `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  // penempatan persis seperti str.center() Python: sisa ganjil jatuh di KIRI
  const marg = Math.max(0, cols - stamp.length);
  const left = (marg >> 1) + (marg & cols & 1);
  return [" ".repeat(left) + stamp, "-".repeat(cols)];
}
function renderTable(rows, numbered, cols, now, headers){
  const out = [];
  if (headers) out.push(...headerLines(now, cols));
  if (rows.length){
    const qtyW = rows.reduce((w,r)=> r[1] ? Math.max(w, r[1].length) : w, 3);
    const unitW = rows.reduce((w,r)=> r[2] ? Math.max(w, r[2].length) : w, 4);
    const noW = numbered ? String(rows.length).length + 1 : 0;
    if (headers){
      let h = numbered ? "No".padEnd(noW) + " " : "";
      h += "Qty".padStart(qtyW) + " " + "Unit".padEnd(unitW) + " Item";
      out.push(h.slice(0, cols), "-".repeat(cols));
    }
    const prefixW = (numbered ? noW + 1 : 0) + qtyW + 1 + unitW + 1;
    const itemW = Math.max(cols - prefixW, 8);
    rows.forEach((r, idx) => {
      const [item, qty, unit] = r;
      const no = numbered ? (String(idx+1)+".").padEnd(noW) + " " : "";
      if (qty != null){
        const first = no + qty.padStart(qtyW) + " " + (unit||"").padEnd(unitW) + " ";
        const ch = wrapWords(item, itemW);
        out.push((first + ch[0]).replace(/\s+$/,""));
        for (let c of ch.slice(1)) out.push(" ".repeat(prefixW) + c);
      } else {
        const ch = wrapWords(item, cols - no.length);
        out.push((no + ch[0]).replace(/\s+$/,""));
        for (let c of ch.slice(1)) out.push(" ".repeat(no.length) + c);
      }
    });
  }
  if (headers) out.push("-".repeat(cols));
  return out.join("\n");
}
/* Baris-baris ber-tab (tempelan sel Excel) dirapikan menjadi kolom sejajar:
   lebar tiap kolom mengikuti isi terpanjangnya, kolom angka rata kanan.
   Jika total melebihi lebar kertas, kolom teks terlebar dilipat ke bawah. */
function alignColumns(rowsCells, cols){
  const nCol = Math.max(...rowsCells.map(r => r.length));
  const isNum = s => /^-?[\d.,]+$/.test(s) && /\d/.test(s);
  const numeric = [], width = [];
  for (let c = 0; c < nCol; c++){
    const vals = rowsCells.map(r => r[c] || "");
    const filled = vals.filter(v => v);
    numeric.push(filled.length > 0 && filled.every(isNum));
    width.push(Math.max(1, ...vals.map(v => v.length)));
  }
  // pilih kolom yang akan dilipat bila kertas tak cukup: kolom teks terlebar
  let wrapCol = 0;
  for (let c = 0; c < nCol; c++)
    if (!numeric[c] && (numeric[wrapCol] || width[c] > width[wrapCol])) wrapCol = c;
  const total = width.reduce((a,b) => a+b, 0) + (nCol - 1);
  if (total > cols) width[wrapCol] = Math.max(6, width[wrapCol] - (total - cols));

  const out = [];
  for (const r of rowsCells){
    const chunks = wrapWords(r[wrapCol] || "", width[wrapCol]);
    chunks.forEach((chunk, k) => {
      let line = "";
      for (let c = 0; c < nCol; c++){
        let v = c === wrapCol ? chunk : (k === 0 ? (r[c] || "") : "");
        v = numeric[c] ? v.padStart(width[c]) : v.padEnd(width[c]);
        line += (c ? " " : "") + v;
      }
      out.push(line.replace(/\s+$/,""));
    });
  }
  return out;
}
function formatPlain(text, numbered, cols, now, headers){
  const out = [];
  if (headers) out.push(...headerLines(now, cols));
  let lines = text.split("\n").map(l => l.replace(/\s+$/,""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length-1].trim()) lines.pop();
  let n = 0, prevBlank = false, tabBlock = [];
  const flushTabs = () => {
    if (!tabBlock.length) return;
    out.push(...alignColumns(tabBlock, cols));
    tabBlock = [];
  };
  for (let line of lines){
    if (!line.trim()){ flushTabs(); if (!prevBlank) out.push(""); prevBlank = true; continue; }
    prevBlank = false;
    if (line.includes("\t")){          // tempelan Excel: kumpulkan, sejajarkan kolomnya
      tabBlock.push(line.split("\t").map(norm));
      continue;
    }
    flushTabs();
    line = norm(line);
    let prefix = "";
    if (numbered){ n += 1; prefix = n + ". "; }
    const indent = numbered ? prefix.length : 2;
    const ch = wrapWords(line, cols - indent);
    out.push(prefix + ch[0]);
    for (let c of ch.slice(1)) out.push(" ".repeat(indent) + c);
  }
  flushTabs();
  if (headers) out.push("-".repeat(cols));
  return out.join("\n");
}
function formatDraft(text, numbered, cols, now, plain, headers){
  if (plain) return formatPlain(text, numbered, cols, now, headers);
  const rows = []; let pos = 0;
  for (let l of text.split("\n")){
    if (!l.trim()){ pos = 0; continue; }
    pos += 1; rows.push(parseLine(l, pos));
  }
  return renderTable(rows, numbered, cols, now, headers);
}
/* ---- mode Excel: kolom Qty boleh berisi hitungan sederhana ---- */
/* "5+3-2" -> "6"; jika bukan ekspresi valid, kembalikan teks apa adanya.
   Dihitung dengan tokenizer kecil supaya perilakunya persis eval() Python
   (termasuk tanda berantai: "5++3" = 8, "5--3" = 8, "5+-3" = 2). */
function evalQty(expr){
  const raw = String(expr).trim();
  const s = raw.replace(/,/g,"");                    // koma = pemisah ribuan
  if (!s || !/^[0-9+\-. ]+$/.test(s)) return raw;
  const toks = s.match(/\d+\.?\d*|\.\d+|[+\-]|\S/g) || [];
  let total = 0, sign = 1, expectNum = true, seenNum = false;
  for (const t of toks){
    if (t === "+" || t === "-"){
      if (t === "-") sign = -sign;
      expectNum = true;
    } else if (/^(\d+\.?\d*|\.\d+)$/.test(t)){
      if (!expectNum && seenNum) return raw;          // dua angka tanpa tanda: "5 3"
      total += sign * parseFloat(t);
      sign = 1; expectNum = false; seenNum = true;
    } else return raw;                                // token asing, mis. "." sendirian
  }
  if (expectNum || !seenNum) return raw;              // menggantung: "5+" / "+"
  return Number.isInteger(total) ? String(total) : String(parseFloat(total.toFixed(6)));
}
/* ---- kalkulator ---- */
function parseAmount(s){
  s = s.trim().replace(/,/g,"");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}
function fmtAmount(v){
  const neg = v < 0;
  let s = Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  if (s.endsWith(".00")) s = s.slice(0,-3);
  return (neg ? "-" : "") + s;
}
function resolveTape(events){
  let total = 0, count = 0;
  const res = [];
  for (const ev of events){
    if (ev[0]==="e"){ total += ev[2]==="+" ? ev[1] : -ev[1]; count++; res.push(ev); }
    else if (ev[0]==="s") res.push(["s", total]);
    else if (ev[0]==="c"){ res.push(["c"]); total = 0; count = 0; }
    else if (ev[0]==="t"){ res.push(["t", total, count]); total = 0; count = 0; }
  }
  return [res, total, count];
}
function renderCalcTape(events, numbered, cols, now, headers, zeroc){
  if (zeroc === undefined) zeroc = true;
  const [res] = resolveTape(events);
  const out = [], lineMap = {};
  if (headers) out.push(...headerLines(now, cols));
  const entries = res.filter(op => op[0]==="e");
  const dateW = entries.reduce((w,op)=> op[3] ? Math.max(w, op[3].length) : w, 0);
  let n = 0, maxN = 0;
  for (const op of res){
    if (op[0]==="e"){ n++; maxN = Math.max(maxN, n); }
    else if (op[0]==="t" || op[0]==="c") n = 0;
  }
  const noW = (numbered && maxN) ? String(maxN).length + 1 : 0;
  n = 0;
  res.forEach((op, i) => {
    if (op[0]==="e"){
      n++;
      let prefix = numbered ? (n+".").padEnd(noW) : "";
      if (dateW) prefix += (prefix ? " " : "") + (op[3]||"").padEnd(dateW);
      const amt = fmtAmount(op[1]);
      lineMap[out.length] = i;
      out.push(prefix + amt.padStart(Math.max(cols - prefix.length - 2, amt.length)) + " " + op[2]);
    } else if (op[0]==="s"){
      out.push(fmtAmount(op[1]).padStart(cols-2) + " S");
    } else if (op[0]==="c"){
      if (zeroc) out.push("0".padStart(cols-2) + " C");
      n = 0;
    } else {
      out.push(`(${op[2]} nota)`.padStart(cols));
      out.push("-".repeat(14).padStart(cols));
      out.push(fmtAmount(op[1]).padStart(cols-2) + " *");
      out.push(""); n = 0;
    }
  });
  if (headers) out.push("-".repeat(cols));
  return [out.join("\n"), lineMap];
}
/* ---- kolom tanggal (d/m) di kalkulator ---- */
/* input 4 angka DDMM -> tampil "d/m" (buang nol depan). mis. 0907 -> 9/7 */
function fmtDate(raw){
  raw = String(raw || "").replace(/\D/g,"").slice(0,4);
  if (raw.length <= 2) return raw;                 // masih mengetik hari
  const d = String(parseInt(raw.slice(0,2), 10));
  const mRaw = raw.slice(2);
  const m = mRaw.length === 2 ? String(parseInt(mRaw, 10)) : mRaw;
  return d + "/" + m;
}
/* tanggal sah = 4 angka DDMM, hari 1..31, bulan 1..12 */
function dateValid(raw){
  raw = String(raw || "");
  if (!/^\d{4}$/.test(raw)) return false;
  const d = parseInt(raw.slice(0,2), 10), m = parseInt(raw.slice(2), 10);
  return d >= 1 && d <= 31 && m >= 1 && m <= 12;
}
/* "9/7" -> "0907" (untuk memuat ulang saat mengedit baris) */
function dateToRaw(disp){
  disp = String(disp || "").trim();
  if (!disp) return "";
  const p = disp.split("/");
  const d = (p[0] || "").replace(/\D/g,"");
  const m = (p[1] || "").replace(/\D/g,"");
  if (p.length < 2) return d.slice(0,4);
  return (d.padStart(2,"0").slice(0,2)) + (m.padStart(2,"0").slice(0,2));
}
/* ---- byte ESC/POS: init + margin kiri + isi + umpan kertas ---- */
function escposPayload(text){
  const head = [0x1b,0x40, 0x1d,0x4c, LEFT_MARGIN_DOTS & 0xff, LEFT_MARGIN_DOTS >> 8];
  const body = [];
  for (const ch of text.replace(/[^\x00-\x7f]/g,"?")) body.push(ch.charCodeAt(0));
  for (let i = 0; i < FEED_LINES; i++) body.push(0x0a);
  return new Uint8Array([...head, ...body]);
}
