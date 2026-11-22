# sokoban-solver

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/fynix39/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/fynix39/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for make.fun's "Build the best Sokoban solver, 21 November 2026" bounty. One program answers all 5 instances of a set in a single run, in as few pushes as possible.

## How it works

The key structural fact of the generated levels: a box pushed through a door into the hallway can never be pushed back, so every box stays in its room and a level's push-optimal count P\* is the sum of its rooms' optima.

1. **Room decomposition** — the dead squares of the player's hallway row are cut out of the floor; each remaining connected component holding boxes is a room.
2. **Push-optimal A\* per room** — search over pushes, not steps; state = sorted box squares + lowest square of the player's reachable region. Admissible heuristic: minimum box→goal assignment cost via bitmask DP over shortest-path distances that ignore boxes.
3. **Deadlock pruning** — dead squares (reverse pull-back from goals) and frozen 2×2 blocks; both provably safe, neither prunes a solvable state.
4. **Move reconstruction** — BFS `walkTo` between consecutive pushes with fixed direction order, so the move string is deterministic.
5. **Safety net** — a level that is not decomposable, or a room search that gives up, falls back to a whole-level A\* search; anything that still fails writes a valid empty `solution.txt` (format gate stays passed, 0 points for that instance only).

Deterministic by construction: no clock reads, no randomness, no environment reads except the input/output directory paths (same as the starter). Work-budgeted only (1,000,000-state cap per search), never clock-budgeted.

## Results (kit scorer, local runs)

- **Practice set: 1,000,000** — all 5 instances solved in P\* pushes (13 / 16 / 29 / 47 / 60), passed 5/5, ~0.3 s for the whole set.
- **26 freshly generated sets: 1,000,000 each** — every instance at P\*, zero non-optimal levels.
- **House baseline plain-astar 1.0.0 for comparison: 200,000 on practice** (solves only i001), 87,500 on a freshly generated set.
- **Determinism:** two full runs on the practice set produce byte-identical outputs.
- Unit tests: `node tests/run-tests.mjs` — 12/12 pass.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is Node 22 erasable TypeScript, standard library only. It reads `/input/<id>/level.txt` for i001–i005 and writes `/output/<id>/solution.txt` (UTF-8, LURD moves), creating `/output/<id>/` itself.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jvcw07av&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
