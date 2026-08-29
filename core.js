/* core.js — logika bersama "Cetak Draft Pesanan".
   SATU-SATUNYA tempat aturan parsing & format berada. Dipakai oleh:
     - index.html di PC   (disajikan bridge.py, cetak lewat COM/antrean Windows)
     - index.html di iPhone (GitHub Pages + Bluefy, cetak lewat Bluetooth LE)
   Ubah aturan di sini sekali -> kedua versi ikut berubah.

   printapp.py memuat salinan aturan yang sama untuk jendela Tk; keduanya
   dijaga tetap sama oleh tests/parity.test.py. Kalau mengubah nama fungsi di
   sini, ubah juga pasangannya di sana supaya hubungannya tetap terbaca. */
"use strict";

/* ================= ukuran kertas ================= */
/* Kertas 58mm: area cetak 384 dot, Font A = 12 dot/karakter, margin kiri
   GS L 12 dot (1,5mm) -> sisa muat 31 kolom. */
const COLS = 31;
const FEED_LINES = 4;
const LEFT_MARGIN_DOTS = 12;

/* ================= tabel pesanan ================= */
/* Lebar minimum kolom Qty & Unit = panjang judulnya sendiri. */
const MIN_QUANTITY_WIDTH = 3;
const MIN_UNIT_WIDTH = 4;
/* Nama barang tidak pernah disempitkan di bawah ini; lebih baik terpotong
   rapi daripada satu huruf per baris. */
const MIN_ITEM_WIDTH = 8;

/* ================= tempelan sel Excel ================= */
/* Kolom dianggap angka bila sebanyak ini bagian isinya angka. Ambang di bawah
   1 supaya baris judul seperti "Jumlah" tidak membatalkan perataan kanan. */
const NUMERIC_COLUMN_RATIO = 0.6;
const WIDE_COLUMN_GAP = 2;
const NARROW_COLUMN_GAP = 1;
const MIN_WRAPPED_COLUMN_WIDTH = 6;

/* ================= pita kalkulator ================= */
/* Ekor " +" / " -" / " S" / " *" di tepi kanan tiap baris nominal. */
const OPERATOR_COLUMN_WIDTH = 2;
const TOTAL_RULE_WIDTH = 14;

/* ================= satuan yang dikenali ================= */
const UNITS = new Set([
  "btg", "btng", "batang", "bh", "buah", "bj", "biji", "lbr", "lembar",
  "lmbr", "sak", "zak", "kg", "ons", "gr", "gram", "ltr", "lt", "liter",
  "gln", "galon", "m", "mtr", "meter", "m2", "m3", "kubik", "kbk",
  "roll", "rol", "dus", "box", "pcs", "pc", "pak", "pack", "ikat",
  "keping", "kaleng", "klg", "set", "unit", "pasang", "psg", "btl",
  "botol", "ember", "drum", "karung", "krg", "lusin", "kodi", "rim",
  "papan",
]);

/* Bentuk baris yang dikenali:
     "Besi beton 8 mm 10 btg"       jumlah + satuan di akhir
     "Amplas nmr 120 .. 2mtr"       jumlah menempel pada satuan
     "5 sak semen 50 kg"            jumlah + satuan di awal
     "1,semen=15" / "kotak=5"       jumlah setelah tanda =
     "1. Tambang ... 30 mtr"        nomor urut & titik pengisi dibuang
     "SKIM COAT 5 sak (utk tangga)" catatan dalam kurung ikut ke kolom Item */
const QUANTITY_RE = /^\d+(?:[.,/]\d+)?$/;
const UNIT_RE = /^[A-Za-z]{1,8}$/;
const GLUED_QUANTITY_RE = /^(\d+(?:[.,/]\d+)?)([A-Za-z][A-Za-z0-9]{0,7})$/;
const TRAILING_NOTE_RE = /\(\s*([^()]*?)\s*\)\s*$/;
const LIST_PREFIX_RE = /^\d{1,2}\s*[.)]+\s*(?=[^\d\s])/;
const COMMA_PREFIX_RE = /^\d{1,2},(?=[A-Za-z])/;
const GLUED_ROW_NUMBER_RE = /^(\d{1,2})(?=[A-Za-z])/;
const EQUALS_QUANTITY_RE = /^(.+?)\s*=\s*(\d+(?:[.,/]\d+)?)$/;
const QUANTITY_FIRST_RE = /^(\d+(?:[.,/]\d+)?)\s*([A-Za-z][A-Za-z0-9]{0,7})\s+(.+)$/;

const DOT_FILLER_RE = /\s*\.{2,}\s*/g;
const LEADING_DOT_RE = /(^|\s)\.+(?=[A-Za-z0-9])/g;
const SURROUNDING_PUNCTUATION_RE = /^[\s.,\-_]+|[\s.,\-_]+$/g;
const TRAILING_SPACE_RE = /\s+$/;

/* ================= teks umum ================= */

function collapseWhitespace(text){
  return text.trim().split(/\s+/).join(" ");
}

function padTwoDigits(value){
  return String(value).padStart(2, "0");
}

function horizontalRule(columns){
  return "-".repeat(columns);
}

function wrapWords(text, width){
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";
  for (const word of words){
    if (!currentLine) currentLine = word;
    else if (currentLine.length + 1 + word.length <= width) currentLine += " " + word;
    else { lines.push(currentLine); currentLine = word; }
    while (currentLine.length > width){        // kata tunggal lebih panjang dari kolom
      lines.push(currentLine.slice(0, width));
      currentLine = currentLine.slice(width);
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [""];
}

function buildHeaderLines(now, columns){
  const day = padTwoDigits(now.getDate());
  const month = padTwoDigits(now.getMonth() + 1);
  const year = String(now.getFullYear());
  const time = `${padTwoDigits(now.getHours())}:${padTwoDigits(now.getMinutes())}`;
  // kertas sempit (mis. ukuran cetak "besar" = 15 kolom): pendekkan tahun,
  // lalu buang tahunnya - urutan yang sama dengan _header_lines() printapp.py
  let stamp = `${day}/${month}/${year} ${time}`;
  if (stamp.length > columns) stamp = `${day}/${month}/${year.slice(-2)} ${time}`;
  if (stamp.length > columns) stamp = `${day}/${month} ${time}`;
  return [centreLikePython(stamp, columns), horizontalRule(columns)];
}

/* str.center() Python menaruh sisa spasi ganjil di KIRI; hasil cetak kedua
   aplikasi harus sama persis, jadi aturannya ditiru apa adanya. */
function centreLikePython(text, columns){
  const margin = Math.max(0, columns - text.length);
  const left = (margin >> 1) + (margin & columns & 1);
  return " ".repeat(left) + text;
}

/* ================= draf pesanan: orkestrasi ================= */

function formatDraft(text, options){
  const {plainText, showRowNumbers, columns, now, showHeaders} = options;
  if (plainText) return formatPlain(text, options);
  return renderTable(parseOrderLines(text), {showRowNumbers, columns, now, showHeaders});
}

/* Nomor urut yang diharapkan dihitung per KELOMPOK: baris kosong memulai
   hitungan dari 1 lagi, supaya "1." di kelompok kedua tetap dikenali. */
function parseOrderLines(text){
  const rows = [];
  let positionInGroup = 0;
  for (const line of text.split("\n")){
    if (!line.trim()){ positionInGroup = 0; continue; }
    positionInGroup += 1;
    rows.push(parseOrderLine(line, positionInGroup));
  }
  return rows;
}

/* ================= draf pesanan: satu baris ================= */

function parseOrderLine(line, expectedRowNumber){
  const {text, note} = extractTrailingNote(collapseWhitespace(line));
  const withoutPrefix = stripRowNumberPrefix(text, expectedRowNumber);
  const {parsed, remaining} = matchQuantityAndUnit(withoutPrefix, expectedRowNumber);
  const [rawItem, quantity, unit] = parsed || [remaining, null, null];
  let itemName = cleanItemName(rawItem);
  if (note) itemName = (itemName + " (" + note + ")").trim();
  return [itemName, quantity, unit];
}

function extractTrailingNote(text){
  const match = text.match(TRAILING_NOTE_RE);
  if (!match) return {text, note: null};
  return {text: text.slice(0, match.index).trim(), note: match[1]};
}

function stripRowNumberPrefix(text, expectedRowNumber){
  const withoutList = text.replace(LIST_PREFIX_RE, "").replace(COMMA_PREFIX_RE, "");
  if (expectedRowNumber == null) return withoutList;
  const glued = withoutList.match(GLUED_ROW_NUMBER_RE);
  if (!glued || parseInt(glued[1]) !== expectedRowNumber) return withoutList;
  return withoutList.slice(glued[1].length);
}

/* Mengembalikan {parsed, remaining}: `remaining` bisa berbeda dari masukan
   karena nomor urut telanjang ikut dibuang, dan teks itulah yang dipakai
   sebagai nama barang bila tak ada jumlah yang cocok sama sekali. */
function matchQuantityAndUnit(text, expectedRowNumber){
  let remaining = text;
  let parsed = matchQuantityFirst(remaining);
  if (!parsed){
    const withoutRowNumber = stripBareRowNumber(remaining, expectedRowNumber);
    if (withoutRowNumber !== null){
      remaining = withoutRowNumber;
      parsed = matchQuantityFirst(remaining);
    }
  }
  if (!parsed) parsed = matchEqualsQuantity(remaining);
  if (!parsed) parsed = matchQuantityLast(remaining);
  return {parsed, remaining};
}

/* "2 imbodus kotak=5": angka di depan TANPA tanda baca hanya dibuang bila
   cocok dengan posisi barisnya DAN sisanya memang berisi jumlah. Kalau tidak,
   angka itu bagian dari nama barangnya. */
function stripBareRowNumber(text, expectedRowNumber){
  if (expectedRowNumber == null) return null;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || !/^\d+$/.test(tokens[0])) return null;
  if (parseInt(tokens[0]) !== expectedRowNumber) return null;
  const rest = tokens.slice(1).join(" ");
  const hasQuantity = EQUALS_QUANTITY_RE.test(rest)
    || matchQuantityLast(rest) || matchQuantityFirst(rest);
  return hasQuantity ? rest : null;
}

function matchQuantityFirst(text){
  const match = text.match(QUANTITY_FIRST_RE);
  if (!match || !UNITS.has(match[2].toLowerCase())) return null;
  return [match[3], match[1], match[2]];
}

function matchEqualsQuantity(text){
  const match = text.match(EQUALS_QUANTITY_RE);
  return match ? [match[1], match[2], ""] : null;
}

function matchQuantityLast(text){
  const tokens = text.split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 3 && QUANTITY_RE.test(tokens[tokens.length - 2]) && UNIT_RE.test(last))
    return [tokens.slice(0, -2).join(" "), tokens[tokens.length - 2], last];
  if (tokens.length < 2) return null;
  const glued = last.match(GLUED_QUANTITY_RE);
  if (!glued) return null;
  const isPlausibleUnit = /^[A-Za-z]+$/.test(glued[2]) || UNITS.has(glued[2].toLowerCase());
  return isPlausibleUnit ? [tokens.slice(0, -1).join(" "), glued[1], glued[2]] : null;
}

function cleanItemName(item){
  return collapseWhitespace(item
    .replace(DOT_FILLER_RE, " ")
    .replace(LEADING_DOT_RE, "$1")
    .replace(SURROUNDING_PUNCTUATION_RE, ""));
}

/* ================= draf pesanan: tabel ================= */

function renderTable(rows, options){
  const {showRowNumbers, columns, now, showHeaders} = options;
  const lines = [];
  if (showHeaders) lines.push(...buildHeaderLines(now, columns));
  if (rows.length){
    const widths = measureTableWidths(rows, showRowNumbers, columns);
    if (showHeaders) lines.push(...buildTableHeading(widths, columns, showRowNumbers));
    rows.forEach((row, index) =>
      lines.push(...renderTableRow(row, index, widths, showRowNumbers, columns)));
  }
  if (showHeaders) lines.push(horizontalRule(columns));
  return lines.join("\n");
}

function measureTableWidths(rows, showRowNumbers, columns){
  const quantityWidth = rows.reduce(
    (widest, row) => row[1] ? Math.max(widest, row[1].length) : widest, MIN_QUANTITY_WIDTH);
  const unitWidth = rows.reduce(
    (widest, row) => row[2] ? Math.max(widest, row[2].length) : widest, MIN_UNIT_WIDTH);
  const numberWidth = showRowNumbers ? String(rows.length).length + 1 : 0;
  const prefixWidth = (showRowNumbers ? numberWidth + 1 : 0) + quantityWidth + 1 + unitWidth + 1;
  return {
    quantityWidth, unitWidth, numberWidth, prefixWidth,
    itemWidth: Math.max(columns - prefixWidth, MIN_ITEM_WIDTH),
  };
}

function buildTableHeading(widths, columns, showRowNumbers){
  let heading = showRowNumbers ? "No".padEnd(widths.numberWidth) + " " : "";
  heading += "Qty".padStart(widths.quantityWidth) + " "
    + "Unit".padEnd(widths.unitWidth) + " Item";
  return [heading.slice(0, columns), horizontalRule(columns)];
}

function renderTableRow(row, index, widths, showRowNumbers, columns){
  const [item, quantity, unit] = row;
  const rowNumber = showRowNumbers
    ? (String(index + 1) + ".").padEnd(widths.numberWidth) + " " : "";
  // tanpa "angka + satuan" di akhir: nama barang memakai lebar penuh kertas
  if (quantity == null)
    return indentedBlock(rowNumber, item, columns - rowNumber.length, rowNumber.length);
  const prefix = rowNumber + quantity.padStart(widths.quantityWidth) + " "
    + (unit || "").padEnd(widths.unitWidth) + " ";
  return indentedBlock(prefix, item, widths.itemWidth, widths.prefixWidth);
}

/* Baris pertama diawali `prefix`, lanjutannya diratakan sedalam `indent`. */
function indentedBlock(prefix, text, width, indent){
  const chunks = wrapWords(text, width);
  const lines = [(prefix + chunks[0]).replace(TRAILING_SPACE_RE, "")];
  for (const chunk of chunks.slice(1)) lines.push(" ".repeat(indent) + chunk);
  return lines;
}

/* ================= teks polos & tempelan Excel ================= */
/* Lebar tiap kolom dihitung SEKALI untuk seluruh tempelan (seperti lebar kolom
   di lembar Excel), jadi baris total yang dipisah baris kosong tetap sejajar
   dengan tabelnya. Baris yang hanya berisi sel PERTAMA (mis. nama toko di atas
   tabel) diperlakukan sebagai teks biasa, bukan bagian tabel. */

function formatPlain(text, options){
  const {showRowNumbers, columns, now, showHeaders} = options;
  const lines = [];
  if (showHeaders) lines.push(...buildHeaderLines(now, columns));
  const sourceLines = trimBlankEdges(
    text.split("\n").map(line => line.replace(TRAILING_SPACE_RE, "")));
  const layout = measureLayoutForTabbedRows(sourceLines, columns);

  let rowNumber = 0;
  let previousLineWasBlank = false;
  for (const sourceLine of sourceLines){
    if (!sourceLine.trim()){
      if (!previousLineWasBlank) lines.push("");
      previousLineWasBlank = true;
      continue;
    }
    previousLineWasBlank = false;
    const columnLines = renderTabbedLine(sourceLine, layout);
    if (columnLines){ lines.push(...columnLines); continue; }
    if (showRowNumbers) rowNumber += 1;
    lines.push(...renderPlainLine(titleCellOrWhole(sourceLine), rowNumber, showRowNumbers, columns));
  }
  if (showHeaders) lines.push(horizontalRule(columns));
  return lines.join("\n");
}

function trimBlankEdges(lines){
  const trimmed = lines.slice();
  while (trimmed.length && !trimmed[0].trim()) trimmed.shift();
  while (trimmed.length && !trimmed[trimmed.length - 1].trim()) trimmed.pop();
  return trimmed;
}

function measureLayoutForTabbedRows(sourceLines, columns){
  const tabbedRows = [];
  for (const line of sourceLines){
    if (!line.trim() || !line.includes("\t")) continue;
    const cells = line.split("\t").map(collapseWhitespace);
    if (!isTitleOnlyRow(cells)) tabbedRows.push(cells);
  }
  return tabbedRows.length ? measureColumnLayout(tabbedRows, columns) : null;
}

/* null bila baris ini bukan bagian tabel - penelepon melanjutkannya sebagai
   teks biasa. */
function renderTabbedLine(line, layout){
  if (!layout || !line.includes("\t")) return null;
  const cells = line.split("\t").map(collapseWhitespace);
  return isTitleOnlyRow(cells) ? null : renderColumnRow(cells, layout);
}

function titleCellOrWhole(line){
  return line.includes("\t") ? collapseWhitespace(line.split("\t")[0]) : collapseWhitespace(line);
}

function renderPlainLine(line, rowNumber, showRowNumbers, columns){
  const prefix = showRowNumbers ? rowNumber + ". " : "";
  const indent = showRowNumbers ? prefix.length : 2;
  const chunks = wrapWords(line, columns - indent);
  const lines = [prefix + chunks[0]];
  for (const chunk of chunks.slice(1)) lines.push(" ".repeat(indent) + chunk);
  return lines;
}

function isTitleOnlyRow(cells){
  return Boolean(cells[0]) && cells.slice(1).every(cell => !cell);
}

function measureColumnLayout(rowsOfCells, columns){
  const columnCount = Math.max(...rowsOfCells.map(row => row.length));
  const alignments = [];
  const widths = [];
  for (let index = 0; index < columnCount; index++){
    alignments.push(alignmentForColumn(rowsOfCells, index));
    widths.push(Math.max(1, ...rowsOfCells.map(row => (row[index] || "").length)));
  }
  const contentWidth = widths.reduce((sum, width) => sum + width, 0);
  const gap = contentWidth + (columnCount - 1) * WIDE_COLUMN_GAP <= columns
    ? WIDE_COLUMN_GAP : NARROW_COLUMN_GAP;
  const wrapColumn = widestTextColumn(alignments, widths, columnCount);
  const total = contentWidth + (columnCount - 1) * gap;
  if (total > columns)
    widths[wrapColumn] = Math.max(MIN_WRAPPED_COLUMN_WIDTH, widths[wrapColumn] - (total - columns));
  return {nCol: columnCount, align: alignments, width: widths, wrapCol: wrapColumn, gap};
}

/* Kolom KODE (angka berawalan nol, mis. nomor PO "021") lebih pantas rata
   tengah daripada rata kanan - ia bukan nilai yang dijumlahkan. */
function alignmentForColumn(rowsOfCells, index){
  const filledCells = rowsOfCells.map(row => row[index] || "").filter(Boolean);
  if (!filledCells.length) return "left";
  const numericCount = filledCells.filter(isNumericCell).length;
  if (numericCount < filledCells.length * NUMERIC_COLUMN_RATIO) return "left";
  return filledCells.some(cell => /^0\d/.test(cell)) ? "center" : "right";
}

function isNumericCell(cell){
  return /^-?[\d.,]+$/.test(cell) && /\d/.test(cell);
}

/* Kalau melebihi kertas, kolom teks TERLEBAR yang dilipat - bukan kolom angka,
   yang kehilangan digitnya akan menyesatkan. */
function widestTextColumn(alignments, widths, columnCount){
  let chosen = 0;
  for (let index = 0; index < columnCount; index++)
    if (alignments[index] === "left"
        && (alignments[chosen] !== "left" || widths[index] > widths[chosen]))
      chosen = index;
  return chosen;
}

function renderColumnRow(cells, layout){
  const chunks = wrapWords(cells[layout.wrapCol] || "", layout.width[layout.wrapCol]);
  return chunks.map((chunk, chunkIndex) => {
    let line = "";
    for (let index = 0; index < layout.nCol; index++){
      const cell = index === layout.wrapCol
        ? chunk : (chunkIndex === 0 ? (cells[index] || "") : "");
      line += (index ? " ".repeat(layout.gap) : "")
        + alignCell(cell, layout.width[index], layout.align[index]);
    }
    return line.replace(TRAILING_SPACE_RE, "");
  });
}

function alignCell(cell, width, alignment){
  if (alignment === "right") return cell.padStart(width);
  if (alignment === "center")
    return (" ".repeat(Math.max(0, (width - cell.length) >> 1)) + cell).padEnd(width);
  return cell.padEnd(width);
}

/* ================= angka ================= */

function parseAmount(text){
  const digits = text.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(digits) || digits === "" || digits === ".") return null;
  const amount = parseFloat(digits);
  return isNaN(amount) ? null : amount;
}

/* Baca satu baris tempelan jadi angka (null bila bukan angka). Terima juga
   format Indonesia "1.874.000(,50)" dan awalan "Rp". Dipakai bersama oleh
   tempelan Ctrl+V di kalkulator dan mode --tape-clipboard di printapp.py,
   supaya keduanya membaca angka dengan aturan yang sama. */
function parsePasteAmount(value){
  let text = String(value == null ? "" : value).trim()
    .replace(/^Rp\.?\s*/i, "").replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text))
    text = text.replace(/\./g, "").replace(",", ".");
  return parseAmount(text);
}

function formatAmount(amount){
  const isNegative = amount < 0;
  let text = Math.abs(amount).toLocaleString(
    "en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  if (text.endsWith(".00")) text = text.slice(0, -3);
  return (isNegative ? "-" : "") + text;
}

/* ================= tanggal (d/m) di kalkulator ================= */

/* 4 angka DDMM -> tampil "d/m" tanpa nol depan, mis. "0907" -> "9/7". */
function formatDateForDisplay(rawDigits){
  const digits = String(rawDigits || "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;             // masih mengetik harinya
  const day = String(parseInt(digits.slice(0, 2), 10));
  const monthDigits = digits.slice(2);
  const month = monthDigits.length === 2 ? String(parseInt(monthDigits, 10)) : monthDigits;
  return day + "/" + month;
}

function isValidDate(rawDigits){
  const digits = String(rawDigits || "");
  if (!/^\d{4}$/.test(digits)) return false;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2), 10);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

/* Kebalikan formatDateForDisplay: "9/7" -> "0907", untuk memuat ulang kolom
   Tanggal saat sebuah baris diedit. */
function displayDateToDigits(displayed){
  const text = String(displayed || "").trim();
  if (!text) return "";
  const parts = text.split("/");
  const day = (parts[0] || "").replace(/\D/g, "");
  if (parts.length < 2) return day.slice(0, 4);
  const month = (parts[1] || "").replace(/\D/g, "");
  return day.padStart(2, "0").slice(0, 2) + month.padStart(2, "0").slice(0, 2);
}

/* ================= pita kalkulator ================= */
/* Pita hanya menyimpan kejadian mentah: ("e", nilai, "+"/"-", tanggal), ("s"),
   ("c"), ("t"). Subtotal & TOTAL tidak pernah disimpan - selalu dihitung ulang
   di sini, sehingga mengedit, menghapus, atau memindahkan satu baris otomatis
   membetulkan semua nilai sesudahnya. */

function resolveTape(events){
  const resolved = [];
  let runningTotal = 0;
  let entryCount = 0;
  for (const event of events){
    const kind = event[0];
    if (kind === "e"){
      runningTotal += event[2] === "+" ? event[1] : -event[1];
      entryCount++;
      resolved.push(event);
    } else if (kind === "s"){
      resolved.push(["s", runningTotal]);
    } else if (kind === "c"){
      resolved.push(["c"]);
      runningTotal = 0;
      entryCount = 0;
    } else if (kind === "t"){
      resolved.push(["t", runningTotal, entryCount]);
      runningTotal = 0;
      entryCount = 0;
    }
  }
  return [resolved, runningTotal, entryCount];
}

/* Geser satu baris nominal melewati baris nominal TETANGGANYA (naik/turun).
   Bekerja di ruang baris nominal, bukan index mentah: penanda SUB/TOTAL/0 C
   yang kebetulan ada di antaranya ikut terlewati, jadi satu langkah selalu
   berarti satu perubahan yang terlihat.

   Return [kejadianBaru, indexBaru], atau null bila sudah di ujung / index yang
   diminta bukan baris nominal. */
function moveEntryBy(events, index, step){
  const entryIndices = entryIndicesOf(events);
  const position = entryIndices.indexOf(index);
  if (position < 0) return null;                       // bukan baris nominal
  const targetPosition = position + step;
  if (targetPosition < 0 || targetPosition >= entryIndices.length) return null;
  const moved = events.slice();
  const [event] = moved.splice(index, 1);
  // index tetangga bergeser satu bila letaknya di belakang yang baru dicabut
  const neighbour = entryIndices[targetPosition] - (entryIndices[targetPosition] > index ? 1 : 0);
  const insertAt = step < 0 ? neighbour : neighbour + 1;
  moved.splice(insertAt, 0, event);
  return [moved, insertAt];
}

function entryIndicesOf(events){
  const indices = [];
  for (let index = 0; index < events.length; index++)
    if (events[index][0] === "e") indices.push(index);
  return indices;
}

/* Pita gaya Casio DR-120R: nomor & tanggal di kiri, nominal di kanan.
   Penomoran diulang dari 1 setelah TOTAL atau CA.

   Return [teks, petaBaris] dengan petaBaris = {nomorBarisTeks: indexKejadian}
   untuk baris nominal saja - dipakai antarmuka untuk klik/ketuk-pilih baris. */
function renderCalcTape(events, options){
  const {showRowNumbers, columns, now, showHeaders, showZeroClearLine = true} = options;
  const [resolved] = resolveTape(events);
  const widths = measureTapeWidths(resolved, showRowNumbers);
  const lines = [];
  const lineToEventIndex = {};
  if (showHeaders) lines.push(...buildHeaderLines(now, columns));

  let rowNumber = 0;
  resolved.forEach((event, eventIndex) => {
    const kind = event[0];
    if (kind === "e"){
      rowNumber++;
      lineToEventIndex[lines.length] = eventIndex;
      lines.push(renderTapeEntry(event, rowNumber, widths, columns, showRowNumbers));
      return;
    }
    if (kind === "s"){
      lines.push(rightAlignedWithSuffix(formatAmount(event[1]), "S", columns));
      return;
    }
    if (kind === "c"){
      if (showZeroClearLine) lines.push(rightAlignedWithSuffix("0", "C", columns));
      rowNumber = 0;
      return;
    }
    lines.push(...renderTapeTotal(event, columns));
    rowNumber = 0;
  });

  if (showHeaders) lines.push(horizontalRule(columns));
  return [lines.join("\n"), lineToEventIndex];
}

function measureTapeWidths(resolved, showRowNumbers){
  const entries = resolved.filter(event => event[0] === "e");
  const dateWidth = entries.reduce(
    (widest, event) => event[3] ? Math.max(widest, event[3].length) : widest, 0);
  let rowNumber = 0;
  let highestRowNumber = 0;
  for (const event of resolved){
    if (event[0] === "e"){
      rowNumber++;
      highestRowNumber = Math.max(highestRowNumber, rowNumber);
    } else if (event[0] === "t" || event[0] === "c"){
      rowNumber = 0;
    }
  }
  return {
    dateWidth,
    numberWidth: (showRowNumbers && highestRowNumber) ? String(highestRowNumber).length + 1 : 0,
  };
}

function renderTapeEntry(event, rowNumber, widths, columns, showRowNumbers){
  let prefix = showRowNumbers ? (rowNumber + ".").padEnd(widths.numberWidth) : "";
  // tanggal rata kanan: angka terakhirnya sejajar di semua baris (9/7 vs 10/12)
  if (widths.dateWidth)
    prefix += (prefix ? " " : "") + (event[3] || "").padStart(widths.dateWidth);
  const amount = formatAmount(event[1]);
  const amountWidth = Math.max(
    columns - prefix.length - OPERATOR_COLUMN_WIDTH, amount.length);
  return prefix + amount.padStart(amountWidth) + " " + event[2];
}

function renderTapeTotal(event, columns){
  return [
    `(${event[2]} nota)`.padStart(columns),
    horizontalRule(TOTAL_RULE_WIDTH).padStart(columns),
    rightAlignedWithSuffix(formatAmount(event[1]), "*", columns),
    "",
  ];
}

function rightAlignedWithSuffix(text, suffix, columns){
  return text.padStart(columns - OPERATOR_COLUMN_WIDTH) + " " + suffix;
}

/* ================= byte ESC/POS ================= */
/* init + margin kiri + isi + umpan kertas. */
const ESC = 0x1b;
const GS = 0x1d;
const LINE_FEED = 0x0a;
const ESC_INITIALISE = [ESC, 0x40];
const GS_SET_LEFT_MARGIN = [GS, 0x4c];
const NON_ASCII_RE = /[^\x00-\x7f]/g;

function buildEscposPayload(text){
  const header = [
    ...ESC_INITIALISE,
    ...GS_SET_LEFT_MARGIN, LEFT_MARGIN_DOTS & 0xff, LEFT_MARGIN_DOTS >> 8,
  ];
  const body = [];
  for (const character of text.replace(NON_ASCII_RE, "?"))
    body.push(character.charCodeAt(0));
  for (let line = 0; line < FEED_LINES; line++) body.push(LINE_FEED);
  return new Uint8Array([...header, ...body]);
}
