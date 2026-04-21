// Off-thread parser for large CSV/XLS/XLSX files.
// Posts back { headers, rows } so the UI thread stays responsive.
import * as XLSX from "xlsx";

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const wb = XLSX.read(e.data.buffer, { type: "array", dense: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false }) as any;
    if (rows.length === 0) {
      (self as any).postMessage({ ok: true, headers: [], rows: [] });
      return;
    }
    const headers = (rows[0] || []).map((h) => String(h).trim());
    const data = rows.slice(1)
      .filter((r) => r.some((c) => String(c).trim() !== ""))
      .map((r) => r.map((c) => String(c)));
    (self as any).postMessage({ ok: true, headers, rows: data });
  } catch (err: any) {
    (self as any).postMessage({ ok: false, error: String(err?.message ?? err) });
  }
};
