import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { tr } from '../i18n/translate';

// Escapes text dropped into the generated HTML report so stray "<"/"&" in a
// vegetable name or a farmer's name can't break the table markup.
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// A4 landscape in points, for reports with many columns.
const A4_LANDSCAPE = { width: 842, height: 595 };

// Builds a clean, printable HTML table for a report. `columns` is
// [{ key, label, width?, monospace? }] (width as a CSS width such as '8%';
// monospace for IDs), `rows` is an array of plain objects already formatted for
// display (dates/currency as strings) — this helper only lays them out.
// `landscape` fits wide tables: fixed column widths, smaller text, wrapped cells
// and the header row repeated on every page.
export function buildReportHtml(title, columns, rows, subtitle, { landscape = false } = {}) {
  const generatedOn = new Date().toLocaleString();
  const colgroup = columns.some((c) => c.width)
    ? `<colgroup>${columns.map((c) => `<col${c.width ? ` style="width:${esc(c.width)}"` : ''} />`).join('')}</colgroup>`
    : '';
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td${c.monospace ? ' class="mono"' : ''}>${esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="empty">${esc(tr('cmp.noRecords'))}</td></tr>`;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="color-scheme" content="light" />
        <style>
          * { box-sizing: border-box; }
          /* Always a white page, even when the device or viewer uses dark mode. */
          :root { color-scheme: light; }
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #2B2620; background: #fff; padding: 24px; }
          h1 { font-size: 20px; margin: 0 0 2px; color: #1F4A27; }
          .subtitle { font-size: 12px; color: #6B6255; margin: 0 0 2px; }
          .generated { font-size: 11px; color: #9A9182; margin: 0 0 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          th, td { border: 1px solid #E7DFCE; padding: 6px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
          th { background: #EEF5EA; color: #1F4A27; font-weight: 600; }
          td { background: #fff; }
          tr:nth-child(even) td { background: #FAFAF7; }
          .empty { text-align: center; color: #9A9182; padding: 20px; }
          ${landscape ? `
          @page { size: A4 landscape; margin: 10mm; }
          body { padding: 0; }
          h1 { font-size: 16px; }
          table { table-layout: fixed; font-size: 8.5px; }
          th, td { padding: 4px 4px; line-height: 1.3; }
          th { font-size: 7.5px; overflow-wrap: normal; word-break: normal; }
          td.mono { font-family: Menlo, Consolas, monospace; font-size: 8px; word-break: break-all; }` : ''}
        </style>
      </head>
      <body>
        <h1>VeggieTrack — ${esc(title)}</h1>
        ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
        <p class="generated">${esc(tr('cmp2.generatedOn', { date: generatedOn }))}</p>
        <table>
          ${colgroup}
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </body>
    </html>
  `;
}

// On web, expo-print ignores `html` and calls window.print(), which prints the
// app screen. The report is printed from its own hidden frame instead, so the
// browser's print preview shows only the report document.
const WEB_FRAME_ID = 'veggietrack-report-print';
function printHtmlOnWeb(html) {
  document.getElementById(WEB_FRAME_ID)?.remove();
  const frame = document.createElement('iframe');
  frame.id = WEB_FRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  return new Promise((resolve, reject) => {
    frame.onload = () => {
      const view = frame.contentWindow;
      view.addEventListener('afterprint', () => frame.remove(), { once: true });
      try {
        view.focus();
        view.print();
        resolve();
      } catch (error) {
        frame.remove();
        reject(error);
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

// Generates a PDF of the report and opens the OS share sheet so the user can
// save it, print it, or send it elsewhere. Browsers cannot write a PDF file
// directly, so on web the report opens in the print dialog, where "Save as PDF"
// saves it.
export async function exportReportPdf(title, columns, rows, subtitle, options = {}) {
  const html = buildReportHtml(title, columns, rows, subtitle, options);
  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, ...(options.landscape ? A4_LANDSCAPE : {}) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

// Sends the report straight to the print flow (no intermediate file).
export async function printReport(title, columns, rows, subtitle, options = {}) {
  const html = buildReportHtml(title, columns, rows, subtitle, options);
  if (Platform.OS === 'web') {
    await printHtmlOnWeb(html);
    return;
  }
  await Print.printAsync({ html, ...(options.landscape ? { orientation: Print.Orientation?.landscape } : {}) });
}
