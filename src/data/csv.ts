export type Row = Record<string, string>;

/**
 * Incremental CSV reader for orbit data. Text can arrive in chunks split anywhere, even mid-quote.
 * Columns are mapped by the header line, and a repeated header re-maps them, so files joined end to
 * end read as one. A line starting "# " names the section the following rows belong to.
 */
export class CsvReader {
  private header: string[] | null = null;
  private section = '';
  private pending = '';

  constructor(
    private readonly onRow: (row: Row, section: string) => void,
    /** A column every header has, which no data row could contain as a value. */
    private readonly headerColumn = 'OBJECT_NAME',
  ) {}

  push(text: string) {
    const buffer = this.pending + text;
    let start = 0;
    let quoted = false;
    for (let i = 0; i < buffer.length; i++) {
      const c = buffer.charCodeAt(i);
      if (c === 34) quoted = !quoted;
      else if (c === 10 && !quoted) {
        this.line(buffer.slice(start, i));
        start = i + 1;
      }
    }
    this.pending = buffer.slice(start);
  }

  end() {
    if (this.pending) this.line(this.pending);
    this.pending = '';
  }

  private line(raw: string) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) return;
    if (line.startsWith('# ')) {
      this.section = line.slice(2).trim();
      return;
    }
    const cells = splitLine(line);
    if (!this.header || cells.includes(this.headerColumn)) {
      this.header = cells;
      return;
    }
    if (!this.header) return;
    const row: Row = {};
    for (let i = 0; i < this.header.length; i++) row[this.header[i]!] = cells[i] ?? '';
    this.onRow(row, this.section);
  }
}

export function splitLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

/** Reads a byte stream through a CsvReader, yielding to the caller after each network chunk. */
export async function readCsv(stream: ReadableStream<BufferSource>, reader: CsvReader, onChunk?: () => void) {
  const text = stream.pipeThrough(new TextDecoderStream()).getReader();
  for (let chunk = await text.read(); !chunk.done; chunk = await text.read()) {
    reader.push(chunk.value);
    onChunk?.();
  }
  reader.end();
}
