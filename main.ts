// Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
//
// Strategy: the generated levels are a hallway with independent rooms off it.
// A box pushed out of a room through its door can never be pushed back, so
// every box stays in its room and the level's push optimum is the sum of the
// rooms' optima. We therefore decompose the level into rooms and solve each
// room push-optimally on its own, then concatenate the room solutions with
// the player's walks between them.
//
// Each room is solved with A* over pushes (a state is the boxes' squares plus
// the player's reachable region; each step costs one push). The heuristic is
// the minimum box-to-goal assignment cost (bitmask DP over shortest-path
// distances that ignore boxes), which never overestimates the pushes left, so
// the first solved state popped is push-optimal. Dead squares (from which no
// pull can ever reach a goal) and frozen 2x2 blocks are pruned; neither prunes
// a solvable state.
//
// Deterministic by construction: no clock, no randomness, no environment reads
// that affect output. All budgets are counts of work (states expanded), never
// time. Ties in the search are broken by a fixed order (f, then h, then
// insertion order), so two runs on the same input write byte-identical output.
//
// Node 22, erasable TypeScript only; plain JavaScript runs as-is.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** [dx, dy, step letter, push letter] for the four directions, fixed order. */
export const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

export interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

export interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
}

/** The most states one push search expands before it gives up (work, never time). */
export const MAX_STATES = 1_000_000;

/** Parse XSB text (# wall, space floor, . goal, $ box, * box on goal, @ player, + player on goal). */
export function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outermost frame is wall whatever it shows: nothing leaves the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/**
 * The squares from which a box alone can be pushed onto some goal: pull back
 * from the goals over open floor. A square y is live when a box on y can be
 * pushed one step toward a live square x (y + d = x) with the player able to
 * stand at y - d.
 */
export function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway: a
 * box there reaches no goal) out of the floor; each remaining connected part
 * holding boxes is a room. Null when the level is no set of rooms (a box in
 * the hallway, or a part holding a different count of boxes and goals).
 */
export function roomsOf(level: Level): Room[] | null {
  const { w, wall } = level;
  const size = w * level.h;
  const live = liveSquares(level);
  const row = Math.floor(level.player / w);
  const cut = new Uint8Array(size);
  for (let x = 0; x < w; x++) {
    const i = row * w + x;
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (level.boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(size).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i] + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of level.boxes) rooms[part[b]].boxes.push(b);
  for (const g of level.goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes holding a box off its goal. */
function frozenBlock(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters (fixed direction order on ties). */
export function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** The square the player stands on after `moves` (case aside) from `from` on a board `w` wide. */
export function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/** Replay `moves` on the level: whether every box ends on a goal, and how many pushes it took (-1 when a move is illegal). */
export function replay(level: Level, moves: string): { solved: boolean; pushes: number } {
  const box = new Uint8Array(level.w * level.h);
  for (const b of level.boxes) box[b] = 1;
  const goal = new Uint8Array(level.w * level.h);
  for (const g of level.goals) goal[g] = 1;
  let player = level.player;
  let pushes = 0;
  for (const ch of moves) {
    const dir = DIRS.find(([, , l, u]) => l === ch.toLowerCase() || u === ch);
    if (dir === undefined) return { solved: false, pushes: -1 };
    const d = dir[1] * level.w + dir[0];
    const next = player + d;
    if (level.wall[next]) return { solved: false, pushes: -1 };
    if (box[next]) {
      const beyond = next + d;
      if (level.wall[beyond] || box[beyond]) return { solved: false, pushes: -1 };
      box[next] = 0;
      box[beyond] = 1;
      pushes++;
    }
    player = next;
  }
  for (let i = 0; i < box.length; i++) if (box[i] && !goal[i]) return { solved: false, pushes };
  return { solved: true, pushes };
}

/**
 * The push-optimal solution of `level` ({pushes, moves}, moves in LURD with an
 * upper letter marking a push), or null when the search gives up (or the level
 * has no solution). A* over pushes with an admissible heuristic: the minimum
 * box-to-goal assignment cost over shortest-path distances that ignore boxes.
 */
export function solvePushOptimal(level: Level, maxStates: number = MAX_STATES): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (level.boxes.some((b) => !live[b])) return null;
  if (solved(level.boxes)) return { pushes: 0, moves: '' };

  // Shortest-path distance from each goal over walls alone (boxes ignored).
  const goalDist: Int32Array[] = goals.map((g) => {
    const dist = new Int32Array(size).fill(-1);
    dist[g] = 0;
    const q = [g];
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      for (const [dx, dy] of DIRS) {
        const n = p + dy * w + dx;
        if (!wall[n] && dist[n] < 0) {
          dist[n] = dist[p] + 1;
          q.push(n);
        }
      }
    }
    return dist;
  });

  // Minimum assignment cost of boxes to goals (bitmask DP; exact while the
  // counts match, which rooms and whole levels both satisfy). Falls back to
  // the sum of per-box minima when they do not. Either way a lower bound on
  // the pushes left, so A* stays optimal.
  const heuristic = (boxes: number[]): number => {
    const n = boxes.length;
    if (n !== goals.length) {
      let sum = 0;
      for (const b of boxes) {
        let m = Infinity;
        for (let gi = 0; gi < goals.length; gi++) {
          const d = goalDist[gi][b];
          if (d >= 0 && d < m) m = d;
        }
        if (m === Infinity) return Infinity;
        sum += m;
      }
      return sum;
    }
    const total = 1 << n;
    const dp = new Float64Array(total).fill(Infinity);
    dp[0] = 0;
    for (let mask = 0; mask < total; mask++) {
      let i = 0;
      for (let m = mask; m > 0; m >>= 1) i += m & 1;
      if (i >= n || dp[mask] === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const d = goalDist[j][boxes[i]];
        if (d < 0) continue;
        const nm = mask | (1 << j);
        const v = dp[mask] + d;
        if (v < dp[nm]) dp[nm] = v;
      }
    }
    return dp[total - 1];
  };

  const h0 = heuristic(level.boxes);
  if (h0 === Infinity) return null;

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  // The squares the player reaches from `from` with `occupied` in the way,
  // marked in `seenArr` with `st`; returns the region's lowest square.
  const reachLow = (from: number, occ: Uint8Array, seenArr: Int32Array, st: number): number => {
    let low = from;
    let n = 0;
    stack[n++] = from;
    seenArr[from] = st;
    while (n > 0) {
      const p = stack[--n];
      if (p < low) low = p;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
        if (!wall[q] && !occ[q] && seenArr[q] !== st) {
          seenArr[q] = st;
          stack[n++] = q;
        }
      }
    }
    return low;
  };

  // The states in the order found: their boxes, the player's square after the
  // push that made them, their region's lowest square, pushes so far, parent
  // and the push that made them from their parent.
  const sBoxes: number[][] = [level.boxes.slice()];
  const sPlayer: number[] = [level.player];
  const sLow: number[] = [reachLow(level.player, occupied, seen, ++stamp)];
  const sG: number[] = [0];
  const sParent: number[] = [-1];
  const sFrom: number[] = [-1];
  const sTo: number[] = [-1];
  const keyOf = (boxes: number[], low: number): string => low + ':' + boxes.join(',');
  const best = new Map<string, number>([[keyOf(level.boxes, sLow[0]), 0]]);

  // Binary heap on (f, h, insertion order): fixed tie-breaking, deterministic.
  const heap: [number, number, number, number][] = [];
  let seq = 0;
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1], heap[c])) c++;
        if (!less(heap[c], heap[i])) break;
        const t = heap[i];
        heap[i] = heap[c];
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };
  heapPush([h0, h0, seq++, 0]);

  let expanded = 0;
  let found = -1;
  while (heap.length > 0) {
    const [, , , s] = heapPop();
    const boxes = sBoxes[s];
    if (best.get(keyOf(boxes, sLow[s])) !== sG[s]) continue; // superseded entry
    if (solved(boxes)) {
      found = s;
      break;
    }
    if (++expanded > maxStates) return null;
    for (const b of boxes) occupied[b] = 1;
    const here = ++stamp;
    reachLow(sPlayer[s], occupied, seen, here);
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi];
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(level, occupied, goal, t);
        let next: number[] | null = null;
        let low = -1;
        let h2 = Infinity;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          low = reachLow(b, occupied, mark, ++stamp);
          h2 = heuristic(next);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (next === null || h2 === Infinity) continue;
        const key = keyOf(next, low);
        const g2 = sG[s] + 1;
        const prev = best.get(key);
        if (prev !== undefined && prev <= g2) continue;
        best.set(key, g2);
        const idx = sBoxes.length;
        sBoxes.push(next);
        sPlayer.push(b);
        sLow.push(low);
        sG.push(g2);
        sParent.push(s);
        sFrom.push(b);
        sTo.push(t);
        heapPush([g2 + h2, h2, seq++, idx]);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;

  // The path of states, then the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = sParent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = sBoxes[s];
    const from = sFrom[s];
    const to = sTo[s];
    const d = to - from;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d);
    if (dir === undefined) throw new Error('solvePushOptimal: bad push in path');
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/**
 * The level solved room by room: each room's push-optimal solution in turn,
 * the other rooms' boxes standing as walls (on their goals once their room is
 * done), the player walking on from where the last room left it. A box never
 * leaves its room, so the rooms' optima add up to the level's. Falls back to
 * a whole-level search when the level is no set of rooms, or a room's search
 * gives up.
 */
export function solveLevel(level: Level): { pushes: number; moves: string } | null {
  const rooms = roomsOf(level);
  if (rooms === null) return solvePushOptimal(level);
  let player = level.player;
  let pushes = 0;
  let moves = '';
  const done = new Set<number>();
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const wall = level.wall.slice();
    for (let oj = 0; oj < rooms.length; oj++) {
      if (oj === ri) continue;
      const src = done.has(oj) ? rooms[oj].goals : rooms[oj].boxes;
      for (const b of src) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solvePushOptimal(sub);
    if (solved === null) return solvePushOptimal(level);
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    done.add(ri);
  }
  return { pushes, moves };
}

// The entrypoint: answer every instance in /input, writing /output/<id>/solution.txt.
// A level that fails to solve still gets a (valid, empty) answer, so the entry passes the format gate.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (const id of readdirSync(I).sort()) {
    let moves = '';
    try {
      const level = parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
      moves = solveLevel(level)?.moves ?? '';
    } catch (e) {
      console.error(`sokoban: ${id}: ${(e as Error).message}`);
      moves = '';
    }
    mkdirSync(join(O, id), { recursive: true });
    writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
  }
}
