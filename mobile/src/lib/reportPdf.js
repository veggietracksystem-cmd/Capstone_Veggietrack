import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

// Escapes text dropped into the generated HTML report so stray "<"/"&" in a
// vegetable name or a farmer's name can't break the table markup.
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Builds a clean, printable HTML table for a report. `columns` is
// [{ key, label }], `rows` is an array of plain objects already formatted
// for display (dates/currency as strings) — this helper only lays them out.
function buildReportHtml(title, columns, rows, subtitle) {
  const generatedOn = new Date().toLocaleString();
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="empty">No records</td></tr>`;

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #2B2620; padding: 24px; }
          h1 { font-size: 20px; margin: 0 0 2px; color: #1F4A27; }
          .subtitle { font-size: 12px; color: #6B6255; margin: 0 0 2px; }
          .generated { font-size: 11px; color: #9A9182; margin: 0 0 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #E7DFCE; padding: 6px 8px; text-align: left; }
          th { background: #EEF5EA; color: #1F4A27; font-weight: 600; }
          tr:nth-child(even) td { background: #FAFAF7; }
          .empty { text-align: center; color: #9A9182; padding: 20px; }
        </style>
      </head>
      <body>
        <h1>VeggieTrack — ${esc(title)}</h1>
        ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
        <p class="generated">Generated on ${esc(generatedOn)}</p>
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </body>
    </html>
  `;
}

// Generates a PDF for the report and opens the OS share sheet so the user
// can save it, print it, or send it elsewhere. On web it opens the browser's
// print dialog instead (expo-print's file APIs are native-only).
export async function exportReportPdf(title, columns, rows, subtitle) {
  const html = buildReportHtml(title, columns, rows, subtitle);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

// Sends the report straight to the native print flow (no intermediate file).
export async function printReport(title, columns, rows, subtitle) {
  const html = buildReportHtml(title, columns, rows, subtitle);
  await Print.printAsync({ html });
}
