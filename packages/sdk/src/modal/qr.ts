// Minimal QR Code encoder — byte mode, ECC level M, versions 1-10.
// Self-contained, no dependencies. Based on ISO/IEC 18004.

// --- GF(256) Arithmetic (primitive polynomial x^8+x^4+x^3+x^2+1 = 0x11d) ---

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x >= 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

// --- Reed-Solomon ---

function rsGenPoly(n: number): Uint8Array {
  // Generator polynomial coefficients, high-degree first (excluding leading 1).
  // g(x) = ∏(x + α^i) for i = 0..n-1
  let p = [1]; // high-degree first
  for (let i = 0; i < n; i++) {
    const next = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) {
      next[j] ^= p[j];
      next[j + 1] ^= gfMul(p[j], EXP[i]);
    }
    p = next;
  }
  return new Uint8Array(p.slice(1)); // drop leading 1
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenPoly(ecCount);
  const reg = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const fb = data[i] ^ reg[0];
    for (let j = 0; j < ecCount - 1; j++) reg[j] = reg[j + 1] ^ gfMul(fb, gen[j]);
    reg[ecCount - 1] = gfMul(fb, gen[ecCount - 1]);
  }
  return reg;
}

// --- Version parameters (ECC-M, byte mode) ---

interface VersionParams {
  ecPerBlock: number;
  groups: [count: number, dataPerBlock: number][];
}

const VERSIONS: VersionParams[] = [
  { ecPerBlock: 10, groups: [[1, 16]] },                 // v1
  { ecPerBlock: 16, groups: [[1, 28]] },                 // v2
  { ecPerBlock: 26, groups: [[1, 44]] },                 // v3
  { ecPerBlock: 18, groups: [[2, 32]] },                 // v4
  { ecPerBlock: 24, groups: [[2, 43]] },                 // v5
  { ecPerBlock: 16, groups: [[4, 27]] },                 // v6
  { ecPerBlock: 18, groups: [[4, 31]] },                 // v7
  { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },       // v8
  { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },       // v9
  { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },       // v10
  { ecPerBlock: 30, groups: [[1, 50], [4, 51]] },       // v11
  { ecPerBlock: 22, groups: [[6, 36], [2, 37]] },       // v12
  { ecPerBlock: 22, groups: [[8, 37], [1, 38]] },       // v13
  { ecPerBlock: 24, groups: [[4, 40], [5, 41]] },       // v14
  { ecPerBlock: 24, groups: [[5, 41], [5, 42]] },       // v15
  { ecPerBlock: 28, groups: [[7, 45], [3, 46]] },       // v16
  { ecPerBlock: 28, groups: [[10, 46], [1, 47]] },      // v17
  { ecPerBlock: 26, groups: [[9, 43], [4, 44]] },       // v18
  { ecPerBlock: 26, groups: [[3, 44], [11, 45]] },      // v19
  { ecPerBlock: 26, groups: [[3, 41], [13, 42]] },      // v20
];

const ALIGNMENT: number[][] = [
  [],              // v1
  [6, 18],         // v2
  [6, 22],         // v3
  [6, 26],         // v4
  [6, 30],         // v5
  [6, 34],         // v6
  [6, 22, 38],     // v7
  [6, 24, 42],     // v8
  [6, 26, 46],     // v9
  [6, 28, 50],     // v10
  [6, 30, 54],     // v11
  [6, 32, 58],     // v12
  [6, 34, 62],     // v13
  [6, 26, 46, 66], // v14
  [6, 26, 48, 70], // v15
  [6, 26, 50, 74], // v16
  [6, 30, 54, 78], // v17
  [6, 30, 56, 82], // v18
  [6, 30, 58, 86], // v19
  [6, 34, 62, 90], // v20
];

// Byte capacity per version at ECC-M (after mode + count overhead)
const CAPACITY = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213,   // v1-10
  251, 287, 331, 362, 412, 450, 504, 560, 614, 666, // v11-20
];

// --- Data encoding ---

function selectVersion(len: number): number {
  for (let v = 0; v < CAPACITY.length; v++) {
    if (len <= CAPACITY[v]) return v + 1;
  }
  throw new Error(`Data too long for QR (max ${CAPACITY[CAPACITY.length - 1]} bytes)`);
}

function encodeData(text: string, version: number): Uint8Array {
  const vp = VERSIONS[version - 1];
  const totalData = vp.groups.reduce((s, [c, d]) => s + c * d, 0);
  const bytes = new TextEncoder().encode(text);

  // Bit stream: mode(4) + count(8 or 16) + data + terminator + padding
  const countBits = version <= 9 ? 8 : 16;
  const bits: number[] = [];
  const push = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  push(0b0100, 4);          // byte mode indicator
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);

  // Terminator (up to 4 zero bits, don't exceed capacity)
  const cap = totalData * 8;
  const term = Math.min(4, cap - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes (alternating 0xEC, 0x11)
  const pads = [0xec, 0x11];
  let pi = 0;
  while (bits.length < cap) {
    push(pads[pi], 8);
    pi ^= 1;
  }

  // Convert to codewords
  const codewords = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    codewords[i] = byte;
  }
  return codewords;
}

// --- Interleaving ---

function interleave(data: Uint8Array, version: number): Uint8Array {
  const vp = VERSIONS[version - 1];
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;

  for (const [count, dataPerBlock] of vp.groups) {
    for (let i = 0; i < count; i++) {
      const blockData = data.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      blocks.push({ data: blockData, ec: rsEncode(blockData, vp.ecPerBlock) });
    }
  }

  const result: number[] = [];

  // Interleave data codewords
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]);
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < vp.ecPerBlock; i++) {
    for (const block of blocks) result.push(block.ec[i]);
  }

  return new Uint8Array(result);
}

// --- Matrix construction ---

type Cell = boolean | null; // true=dark, false=light, null=unset
type Grid = Cell[][];

function createGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<Cell>(size).fill(null));
}

function setModule(grid: Grid, row: number, col: number, dark: boolean) {
  if (row >= 0 && row < grid.length && col >= 0 && col < grid.length) {
    grid[row][col] = dark;
  }
}

function placeFinder(grid: Grid, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      setModule(grid, row + r, col + c, inOuter && (onBorder || inInner));
    }
  }
}

function placeAlignment(grid: Grid, version: number) {
  const pos = ALIGNMENT[version - 1];
  if (pos.length === 0) return;
  for (const r of pos) {
    for (const c of pos) {
      // Skip if overlapping with finder patterns
      if (r <= 8 && c <= 8) continue;                          // top-left
      if (r <= 8 && c >= grid.length - 8) continue;            // top-right
      if (r >= grid.length - 8 && c <= 8) continue;            // bottom-left
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setModule(grid, r + dr, c + dc, dark);
        }
      }
    }
  }
}

function placeTiming(grid: Grid) {
  const size = grid.length;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (grid[6][i] === null) grid[6][i] = dark;
    if (grid[i][6] === null) grid[i][6] = dark;
  }
}

function reserveFormatAreas(grid: Grid, version: number) {
  const size = grid.length;
  // Format info around top-left finder
  for (let i = 0; i <= 8; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  // Format info along top-right and bottom-left
  for (let i = 0; i < 8; i++) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false;
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
  }
  // Dark module
  grid[size - 8][8] = true;
  // Version info areas (v >= 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        if (grid[i][size - 11 + j] === null) grid[i][size - 11 + j] = false;
        if (grid[size - 11 + j][i] === null) grid[size - 11 + j][i] = false;
      }
    }
  }
}

function placeData(grid: Grid, codewords: Uint8Array) {
  const size = grid.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let col = size - 1;
  let upward = true;

  while (col >= 0) {
    if (col === 6) col--; // skip timing column
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || grid[row][c] !== null) continue;
        if (bitIdx < totalBits) {
          grid[row][c] = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        } else {
          grid[row][c] = false;
        }
      }
    }
    col -= 2;
    upward = !upward;
  }
}

// --- Masking ---

const MASK_FNS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function isReserved(funcGrid: Grid, r: number, c: number): boolean {
  return funcGrid[r][c] !== null;
}

function applyMask(grid: Grid, funcGrid: Grid, pattern: number): boolean[][] {
  const size = grid.length;
  const result: boolean[][] = [];
  const maskFn = MASK_FNS[pattern];
  for (let r = 0; r < size; r++) {
    result[r] = [];
    for (let c = 0; c < size; c++) {
      const val = grid[r][c] as boolean;
      result[r][c] = isReserved(funcGrid, r, c) ? val : val !== maskFn(r, c);
    }
  }
  return result;
}

function calcPenalty(matrix: boolean[][]): number {
  const size = matrix.length;
  let penalty = 0;

  // Rule 1: adjacent same-color runs
  for (let r = 0; r < size; r++) {
    let runH = 1, runV = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) { runH++; } else { if (runH >= 5) penalty += runH - 2; runH = 1; }
      if (matrix[c][r] === matrix[c - 1][r]) { runV++; } else { if (runV >= 5) penalty += runV - 2; runV = 1; }
    }
    if (runH >= 5) penalty += runH - 2;
    if (runV >= 5) penalty += runV - 2;
  }

  // Rule 2: 2x2 same-color blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) penalty += 3;
    }
  }

  // Rule 3: finder-like patterns (1011101 with 4 light on either side)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 10; c++) {
      if (matchFinderPattern(matrix, r, c, true)) penalty += 40;
      if (matchFinderPattern(matrix, r, c, false)) penalty += 40;
    }
  }

  // Rule 4: dark proportion
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r][c]) dark++;
  const pct = (dark * 100) / (size * size);
  const prev5 = Math.floor(pct / 5) * 5;
  penalty += Math.min(Math.abs(prev5 - 50), Math.abs(prev5 + 5 - 50)) * 2;

  return penalty;
}

function matchFinderPattern(m: boolean[][], r: number, c: number, horizontal: boolean): boolean {
  const g = (i: number) => horizontal ? m[r][c + i] : m[c + i][r];
  // Pattern: 1,0,1,1,1,0,1,0,0,0,0
  const p1 = g(0) && !g(1) && g(2) && g(3) && g(4) && !g(5) && g(6) && !g(7) && !g(8) && !g(9) && !g(10);
  // Pattern: 0,0,0,0,1,0,1,1,1,0,1
  const p2 = !g(0) && !g(1) && !g(2) && !g(3) && g(4) && !g(5) && g(6) && g(7) && g(8) && !g(9) && g(10);
  return p1 || p2;
}

// --- Format & version info ---

function bchFormat(data: number): number {
  let d = data << 10;
  for (let i = 14; i >= 10; i--) if (d & (1 << i)) d ^= 0x537 << (i - 10);
  return ((data << 10) | d) ^ 0x5412;
}

function bchVersion(version: number): number {
  let d = version << 12;
  for (let i = 17; i >= 12; i--) if (d & (1 << i)) d ^= 0x1f25 << (i - 12);
  return (version << 12) | d;
}

function placeFormatInfo(matrix: boolean[][], mask: number) {
  const size = matrix.length;
  const info = bchFormat((0b00 << 3) | mask); // ECC-M = 00

  for (let i = 0; i < 15; i++) {
    const bit = ((info >> (14 - i)) & 1) === 1;

    // Around top-left finder (horizontal part: row 8)
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else matrix[14 - i][8] = bit;

    // Bottom-left and top-right
    if (i < 8) matrix[size - 1 - i][8] = bit;
    else matrix[8][size - 15 + i] = bit;
  }
}

function placeVersionInfo(matrix: boolean[][], version: number) {
  if (version < 7) return;
  const size = matrix.length;
  const info = bchVersion(version);
  for (let i = 0; i < 18; i++) {
    const bit = ((info >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    matrix[row][col] = bit;
    matrix[col][row] = bit;
  }
}

// --- Public API ---

export function encode(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = selectVersion(bytes.length);
  const size = 4 * version + 17;

  // Build function pattern grid (finders, alignment, timing, reserved areas)
  const funcGrid = createGrid(size);
  placeFinder(funcGrid, 0, 0);
  placeFinder(funcGrid, 0, size - 7);
  placeFinder(funcGrid, size - 7, 0);
  placeAlignment(funcGrid, version);
  placeTiming(funcGrid);
  reserveFormatAreas(funcGrid, version);

  // Build data grid: start with function patterns, then place data
  const dataCodewords = encodeData(text, version);
  const allCodewords = interleave(dataCodewords, version);
  const dataGrid = createGrid(size);

  // Copy function patterns
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (funcGrid[r][c] !== null) dataGrid[r][c] = funcGrid[r][c];
    }
  }

  // Place data bits
  placeData(dataGrid, allCodewords);

  // Try all 8 masks, pick best
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestMatrix: boolean[][] = [];

  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(dataGrid, funcGrid, mask);
    placeFormatInfo(masked, mask);
    placeVersionInfo(masked, version);
    const p = calcPenalty(masked);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
      bestMatrix = masked;
    }
  }

  // Apply best mask to final matrix
  if (bestMatrix.length === 0) {
    bestMatrix = applyMask(dataGrid, funcGrid, bestMask);
    placeFormatInfo(bestMatrix, bestMask);
    placeVersionInfo(bestMatrix, bestMask);
  }

  return bestMatrix;
}

function escAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function toSvg(
  matrix: boolean[][],
  options?: { size?: number; margin?: number; darkColor?: string; lightColor?: string },
): string {
  const { size: px = 200, margin = 2, darkColor = '#000', lightColor = '#fff' } = options ?? {};
  const n = matrix.length;
  const total = n + margin * 2;
  let path = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${escAttr(lightColor)}"/>` +
    `<path d="${path}" fill="${escAttr(darkColor)}"/>` +
    `</svg>`
  );
}
