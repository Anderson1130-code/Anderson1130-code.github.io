import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "./pdf-lib.esm.min.js";
import * as pdfjsLib from "./pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";

const A4 = [595.28, 841.89];
const MARGIN = 42;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const COLORS = {
  blue: rgb(0.027, 0.337, 0.647),
  darkBlue: rgb(0.024, 0.227, 0.439),
  gold: rgb(1, 0.769, 0),
  text: rgb(0.09, 0.145, 0.227),
  muted: rgb(0.38, 0.44, 0.53),
  line: rgb(0.79, 0.84, 0.89),
  paleBlue: rgb(0.95, 0.97, 0.99),
  red: rgb(0.706, 0.137, 0.094),
  paleRed: rgb(1, 0.94, 0.94),
  green: rgb(0.098, 0.529, 0.329),
  paleGreen: rgb(0.91, 0.97, 0.93),
  white: rgb(1, 1, 1),
};

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function valueAfter(lines, labels, fallback = "Não informado") {
  const normalizedLabels = labels.map(normalize);
  for (const line of lines) {
    const normalizedLine = normalize(line);
    const label = normalizedLabels.find((candidate) => normalizedLine.startsWith(`${candidate}:`));
    if (label) return line.slice(line.indexOf(":") + 1).trim() || fallback;
  }
  return fallback;
}

function sectionLines(lines, startLabels, endLabels = []) {
  const starts = startLabels.map(normalize);
  const ends = endLabels.map(normalize);
  const startIndex = lines.findIndex((line) => starts.includes(normalize(line)));
  if (startIndex < 0) return [];
  const output = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (ends.includes(normalize(lines[index]))) break;
    output.push(lines[index]);
  }
  return output;
}

function parseIssues(lines) {
  return sectionLines(lines, ["ITENS NAO OK", "ITENS NÃO OK"], ["ITENS OK"])
    .filter((line) => line.trim().startsWith("-"))
    .map((line) => {
      const content = line.replace(/^\s*-\s*/, "").trim();
      const separator = content.indexOf(":");
      return separator >= 0
        ? { item: content.slice(0, separator).trim(), status: content.slice(separator + 1).trim() }
        : { item: content, status: "Não conforme" };
    });
}

function parseOkItems(lines) {
  return sectionLines(lines, ["ITENS OK"])
    .filter((line) => line.trim().startsWith("-"))
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

async function extractChecklist(sourceBytes) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(sourceBytes),
    isEvalSupported: false,
  });
  const sourcePdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
    const page = await sourcePdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = textContent.items
      .map((item) => item.str?.trim())
      .filter(Boolean);
    pages.push({ page, lines, text: lines.join("\n") });
  }

  const allLines = pages.flatMap(({ lines }) => lines);
  const normalizedText = normalize(allLines.join(" "));
  if (!normalizedText.includes("checklist de viatura") || !normalizedText.includes("prefixo da vtr")) {
    throw new Error("UNSUPPORTED_CHECKLIST");
  }

  const photoPages = pages.filter(({ lines }) =>
    lines.some((line) => normalize(line).startsWith("foto:"))
  );
  const contentLines = pages
    .filter((page) => !photoPages.includes(page))
    .flatMap(({ lines }) => lines);

  return {
    prefix: valueAfter(allLines, ["Prefixo da VTR"]),
    model: valueAfter(allLines, ["Modelo da VTR"]),
    officer: valueAfter(allLines, ["Nome de guerra"]),
    ci: valueAfter(allLines, ["C.I", "CI"]),
    shift: valueAfter(allLines, ["Turno"]),
    seg: valueAfter(allLines, ["SEG"]),
    openedAt: valueAfter(allLines, ["Data e horario", "Data e horário"]),
    closedAt: valueAfter(allLines, ["Horario de fechamento", "Horário de fechamento"]),
    initialKm: valueAfter(allLines, ["Km inicial"]),
    finalKm: valueAfter(allLines, ["Km final"]),
    traveledKm: valueAfter(allLines, ["Km percorrido"]),
    initialFuel: valueAfter(allLines, ["Combustivel inicial", "Combustível inicial"]),
    finalFuel: valueAfter(allLines, ["Combustivel final", "Combustível final"]),
    generalDamage: sectionLines(
      contentLines,
      ["AVARIAS GERAIS"],
      ["ITENS NAO OK", "ITENS NÃO OK"]
    ).join(" ") || "Nenhuma observação informada.",
    issues: parseIssues(contentLines),
    okItems: parseOkItems(contentLines),
    photoPages,
    sourcePdf,
  };
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawWrapped(page, text, options) {
  const {
    x,
    y,
    width,
    font,
    size = 8,
    color = COLORS.text,
    lineHeight = size * 1.25,
  } = options;
  const lines = wrapText(text, font, size, width);
  lines.forEach((line, index) => {
    page.drawText(line, { x, y: y - index * lineHeight, size, font, color });
  });
  return lines.length * lineHeight;
}

function drawHeader(page, fonts, prefix) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 54, width, height: 54, color: COLORS.blue });
  page.drawRectangle({ x: 0, y: height - 58, width, height: 4, color: COLORS.gold });
  page.drawText("14ª CICOM - CHECKLIST DE VIATURA", {
    x: MARGIN,
    y: height - 27,
    size: 12,
    font: fonts.bold,
    color: COLORS.white,
  });
  page.drawText("COMANDO DE POLICIAMENTO DE ÁREA - CPA LESTE", {
    x: MARGIN,
    y: height - 40,
    size: 7,
    font: fonts.regular,
    color: COLORS.white,
  });
  const prefixText = `VTR ${prefix}`;
  page.drawText(prefixText, {
    x: width - MARGIN - fonts.bold.widthOfTextAtSize(prefixText, 11),
    y: height - 33,
    size: 11,
    font: fonts.bold,
    color: COLORS.gold,
  });
}

function drawFooter(page, fonts, pageNumber) {
  const { width } = page.getSize();
  page.drawLine({
    start: { x: MARGIN, y: 31 },
    end: { x: width - MARGIN, y: 31 },
    thickness: 0.6,
    color: COLORS.line,
  });
  page.drawText("Documento de controle interno • 14ª CICOM", {
    x: MARGIN,
    y: 19,
    size: 6.5,
    font: fonts.regular,
    color: COLORS.muted,
  });
  const label = `Página ${pageNumber}`;
  page.drawText(label, {
    x: width - MARGIN - fonts.regular.widthOfTextAtSize(label, 6.5),
    y: 19,
    size: 6.5,
    font: fonts.regular,
    color: COLORS.muted,
  });
}

function addPage(context) {
  const page = context.document.addPage(A4);
  context.pageNumber += 1;
  context.page = page;
  context.y = A4[1] - 79;
  drawHeader(page, context.fonts, context.data.prefix);
  drawFooter(page, context.fonts, context.pageNumber);
  return page;
}

function ensureSpace(context, height) {
  if (context.y - height < 45) addPage(context);
}

function drawSection(context, title) {
  ensureSpace(context, 28);
  context.y -= 8;
  context.page.drawText(title, {
    x: MARGIN,
    y: context.y,
    size: 10,
    font: context.fonts.bold,
    color: COLORS.blue,
  });
  context.y -= 15;
}

function drawInfoRows(context, rows) {
  const labelWidth = 88;
  const valueWidth = CONTENT_WIDTH / 2 - labelWidth;
  const rowHeight = 30;
  ensureSpace(context, rows.length * rowHeight);

  rows.forEach(([labelA, valueA, labelB, valueB]) => {
    const y = context.y - rowHeight;
    const cells = [
      { x: MARGIN, width: labelWidth, fill: COLORS.paleBlue, text: labelA, bold: true },
      { x: MARGIN + labelWidth, width: valueWidth, fill: COLORS.white, text: valueA },
      { x: MARGIN + CONTENT_WIDTH / 2, width: labelWidth, fill: COLORS.paleBlue, text: labelB, bold: true },
      { x: MARGIN + CONTENT_WIDTH / 2 + labelWidth, width: valueWidth, fill: COLORS.white, text: valueB },
    ];
    cells.forEach((cell) => {
      context.page.drawRectangle({
        x: cell.x,
        y,
        width: cell.width,
        height: rowHeight,
        color: cell.fill,
        borderColor: COLORS.line,
        borderWidth: 0.55,
      });
      drawWrapped(context.page, cell.text, {
        x: cell.x + 6,
        y: y + 18,
        width: cell.width - 12,
        font: cell.bold ? context.fonts.bold : context.fonts.regular,
        size: 7.5,
        color: cell.bold ? COLORS.darkBlue : COLORS.text,
        lineHeight: 9,
      });
    });
    context.y -= rowHeight;
  });
}

function drawIssues(context) {
  const issues = context.data.issues.length
    ? context.data.issues
    : [{ item: "Nenhuma não conformidade registrada", status: "Conforme" }];
  const headerHeight = 24;
  const rowHeight = 31;
  ensureSpace(context, headerHeight + rowHeight * issues.length);
  const columns = [230, 150, CONTENT_WIDTH - 380];
  const headers = ["Item", "Situação", "Evidência"];
  let x = MARGIN;
  headers.forEach((header, index) => {
    context.page.drawRectangle({
      x,
      y: context.y - headerHeight,
      width: columns[index],
      height: headerHeight,
      color: COLORS.red,
    });
    context.page.drawText(header, {
      x: x + 6,
      y: context.y - 15,
      size: 7.5,
      font: context.fonts.bold,
      color: COLORS.white,
    });
    x += columns[index];
  });
  context.y -= headerHeight;

  issues.forEach((issue) => {
    const values = [
      issue.item,
      issue.status,
      `${context.data.photoPages.length} foto(s)`,
    ];
    x = MARGIN;
    values.forEach((value, index) => {
      context.page.drawRectangle({
        x,
        y: context.y - rowHeight,
        width: columns[index],
        height: rowHeight,
        color: COLORS.paleRed,
        borderColor: rgb(0.88, 0.66, 0.64),
        borderWidth: 0.55,
      });
      drawWrapped(context.page, value, {
        x: x + 6,
        y: context.y - 13,
        width: columns[index] - 12,
        font: context.fonts.regular,
        size: 7.5,
        lineHeight: 9,
      });
      x += columns[index];
    });
    context.y -= rowHeight;
  });
}

async function renderPhotoPage(sourcePage) {
  const viewport = sourcePage.getViewport({ scale: 1.35 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  await sourcePage.render({ canvasContext: context, viewport }).promise;

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = image;
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const index = (y * width + x) * 4;
      const isContent = data[index] < 246 || data[index + 1] < 246 || data[index + 2] < 246;
      if (isContent) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right <= left || bottom <= top) return canvas.toDataURL("image/jpeg", 0.86);
  const padding = 8;
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width, right + padding);
  bottom = Math.min(height, bottom + padding);
  const cropped = document.createElement("canvas");
  cropped.width = right - left;
  cropped.height = bottom - top;
  cropped.getContext("2d", { alpha: false }).drawImage(
    canvas,
    left,
    top,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height
  );
  return cropped.toDataURL("image/jpeg", 0.86);
}

function dataUrlBytes(dataUrl) {
  const binary = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function drawPhotos(context) {
  if (!context.data.photoPages.length) return;
  drawSection(context, "4. REGISTRO FOTOGRÁFICO");
  const onePhoto = context.data.photoPages.length === 1;
  const gap = 10;
  const cellWidth = onePhoto ? CONTENT_WIDTH : (CONTENT_WIDTH - gap) / 2;
  const maxHeight = onePhoto ? 300 : 190;

  for (let index = 0; index < context.data.photoPages.length; index += 1) {
    const column = onePhoto ? 0 : index % 2;
    if (column === 0) ensureSpace(context, maxHeight + 28);
    const dataUrl = await renderPhotoPage(context.data.photoPages[index].page);
    const image = await context.document.embedJpg(dataUrlBytes(dataUrl));
    const scale = Math.min(cellWidth / image.width, maxHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = MARGIN + column * (cellWidth + gap) + (cellWidth - drawWidth) / 2;
    const rowTop = context.y;
    context.page.drawRectangle({
      x: MARGIN + column * (cellWidth + gap),
      y: rowTop - maxHeight - 22,
      width: cellWidth,
      height: maxHeight + 22,
      color: COLORS.white,
      borderColor: COLORS.line,
      borderWidth: 0.55,
    });
    context.page.drawImage(image, {
      x,
      y: rowTop - drawHeight - 4,
      width: drawWidth,
      height: drawHeight,
    });
    const sourceLabel = context.data.photoPages[index].lines
      .find((line) => normalize(line).startsWith("foto:"))
      ?.replace(/^foto:\s*/i, "") || "Evidência fotográfica";
    const caption = `Foto ${index + 1} - ${sourceLabel}`;
    drawWrapped(context.page, caption, {
      x: MARGIN + column * (cellWidth + gap) + 6,
      y: rowTop - maxHeight - 12,
      width: cellWidth - 12,
      font: context.fonts.bold,
      size: 7,
      color: COLORS.darkBlue,
      lineHeight: 8,
    });
    if (onePhoto || column === 1 || index === context.data.photoPages.length - 1) {
      context.y -= maxHeight + 30;
    }
  }
}

function drawObservations(context) {
  drawSection(context, context.data.photoPages.length ? "5. AVARIAS GERAIS / OBSERVAÇÕES" : "4. AVARIAS GERAIS / OBSERVAÇÕES");
  const lines = wrapText(context.data.generalDamage, context.fonts.regular, 8, CONTENT_WIDTH - 16);
  const height = Math.max(34, lines.length * 10 + 14);
  ensureSpace(context, height);
  context.page.drawRectangle({
    x: MARGIN,
    y: context.y - height,
    width: CONTENT_WIDTH,
    height,
    color: COLORS.paleBlue,
    borderColor: COLORS.line,
    borderWidth: 0.55,
  });
  drawWrapped(context.page, context.data.generalDamage, {
    x: MARGIN + 8,
    y: context.y - 14,
    width: CONTENT_WIDTH - 16,
    font: context.fonts.regular,
    size: 8,
    lineHeight: 10,
  });
  context.y -= height;
}

function drawOkItems(context) {
  addPage(context);
  drawSection(context, `${context.data.photoPages.length ? "6" : "5"}. ITENS CONFORMES`);
  const count = context.data.okItems.length;
  context.page.drawRectangle({
    x: MARGIN,
    y: context.y - 30,
    width: CONTENT_WIDTH,
    height: 30,
    color: COLORS.paleGreen,
    borderColor: rgb(0.66, 0.87, 0.74),
    borderWidth: 0.6,
  });
  context.page.drawText(`${count} itens conformes`, {
    x: MARGIN + 8,
    y: context.y - 19,
    size: 9,
    font: context.fonts.bold,
    color: COLORS.green,
  });
  context.y -= 40;

  const columnGap = 14;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  let column = 0;
  let columnY = context.y;
  for (const item of context.data.okItems) {
    const lines = wrapText(item, context.fonts.regular, 7.5, columnWidth - 22);
    const height = Math.max(22, lines.length * 9 + 8);
    if (columnY - height < 46) {
      if (column === 0) {
        column = 1;
        columnY = context.y;
      } else {
        addPage(context);
        drawSection(context, "ITENS CONFORMES - CONTINUAÇÃO");
        column = 0;
        columnY = context.y;
      }
    }
    const x = MARGIN + column * (columnWidth + columnGap);
    context.page.drawRectangle({
      x,
      y: columnY - height,
      width: columnWidth,
      height,
      color: COLORS.white,
      borderColor: COLORS.line,
      borderWidth: 0.4,
    });
    context.page.drawText("OK", {
      x: x + 6,
      y: columnY - 14,
      size: 6.5,
      font: context.fonts.bold,
      color: COLORS.green,
    });
    drawWrapped(context.page, item, {
      x: x + 18,
      y: columnY - 13,
      width: columnWidth - 24,
      font: context.fonts.regular,
      size: 7.5,
      lineHeight: 9,
    });
    columnY -= height;
  }
}

export async function transformChecklistPdf(blob) {
  const sourceBytes = await blob.arrayBuffer();
  const data = await extractChecklist(sourceBytes);
  const document = await PDFDocument.create();
  document.setTitle(`Checklist ${data.prefix} - Modelo 3`);
  document.setSubject("Checklist de viatura reorganizado");
  document.setCreator("Checklist VTR");

  const fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  };
  const context = {
    document,
    fonts,
    data,
    page: null,
    pageNumber: 0,
    y: 0,
  };

  addPage(context);
  drawSection(context, "1. IDENTIFICAÇÃO");
  drawInfoRows(context, [
    ["Prefixo da VTR", data.prefix, "Modelo", data.model],
    ["Nome de guerra", data.officer, "C.I.", data.ci],
    ["Turno", data.shift, "SEG", data.seg],
  ]);
  drawSection(context, "2. SERVIÇO E MEDIÇÕES");
  drawInfoRows(context, [
    ["Abertura", data.openedAt, "Fechamento", data.closedAt],
    ["Km inicial", data.initialKm, "Km final", data.finalKm],
    ["Km percorrido", data.traveledKm, "Combustível", `${data.initialFuel} - ${data.finalFuel}`],
  ]);
  drawSection(context, "3. NÃO CONFORMIDADES");
  drawIssues(context);
  await drawPhotos(context);
  drawObservations(context);
  drawOkItems(context);

  const bytes = await document.save({ useObjectStreams: true });
  if (typeof data.sourcePdf.cleanup === "function") {
    await data.sourcePdf.cleanup();
  }
  if (typeof data.sourcePdf.destroy === "function") {
    await data.sourcePdf.destroy();
  }
  return new Blob([bytes], { type: "application/pdf" });
}
