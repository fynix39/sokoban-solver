// Unit tests for the Sokoban solver (main.ts). Run: node --test tests/run-tests.mjs
// Uses only embedded levels (no kit files), so the suite is self-contained.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLevel,
  liveSquares,
  roomsOf,
  solvePushOptimal,
  solveLevel,
  replay,
} from '../main.ts';

const ONE_BOX = `#####
#@$.#
#####
`;

const TWO_BOX = `######
#@$. #
# $. #
######
`;

const WALK_AROUND = `#######
#@    #
# $   #
#  .  #
#######
`;

const CORNER_TRAP = `#####
#@###
##$ #
# . #
#####
`;

// Practice i001 (P* 13, 1 room of 3) and i003 (P* 29, 2 rooms of 4), embedded.
const I001 = `########
#     ##
#..   ##
#  $ ###
#    ###
###$.###
###   ##
####$###
#     @#
########
`;

const I003 = `########
#...####
# $ ####
#  $####
#. $ ###
#      #
##     #
#####$##
# @    #
### ####
#     .#
# .. $ #
###. $ #
###    #
### $$ #
###  ###
########
`;

test('parseLevel reads walls, goals, boxes and player', () => {
  const lv = parseLevel(`######
#@$. #
# $. #
######`);
  assert.equal(lv.w, 6);
  assert.equal(lv.h, 4);
  assert.deepEqual(lv.boxes, [8, 14]);
  assert.deepEqual(lv.goals, [9, 15]);
  assert.equal(lv.player, 7);
  assert.equal(lv.wall[0], 1);
  assert.equal(lv.wall[7], 0);
});

test('parseLevel handles * and + (box / player on a goal)', () => {
  const lv = parseLevel(`#####
#*+ #
#####`);
  assert.deepEqual(lv.boxes, [6]);
  assert.deepEqual(lv.goals, [6, 7]);
  assert.equal(lv.player, 7);
});

test('liveSquares marks a corner dead and a goal live', () => {
  const lv = parseLevel(CORNER_TRAP);
  const live = liveSquares(lv);
  assert.equal(live[12], 0, 'corner square (2,2) must be dead');
  assert.equal(live[17], 1, 'goal square must be live');
});

test('solvePushOptimal solves a 1-box level in 1 push', () => {
  const r = solvePushOptimal(parseLevel(ONE_BOX));
  assert.ok(r);
  assert.equal(r.pushes, 1);
  assert.equal(r.moves, 'R');
});

test('solvePushOptimal solves a 2-box level in 2 pushes', () => {
  const r = solvePushOptimal(parseLevel(TWO_BOX));
  assert.ok(r);
  assert.equal(r.pushes, 2);
  const end = replay(parseLevel(TWO_BOX), r.moves);
  assert.equal(end.solved, true);
  assert.equal(end.pushes, 2);
});

test('solvePushOptimal walks around the box when needed', () => {
  const r = solvePushOptimal(parseLevel(WALK_AROUND));
  assert.ok(r);
  assert.equal(r.pushes, 2);
  const end = replay(parseLevel(WALK_AROUND), r.moves);
  assert.equal(end.solved, true);
});

test('solvePushOptimal returns null for a corner-trapped box', () => {
  const r = solvePushOptimal(parseLevel(CORNER_TRAP));
  assert.equal(r, null);
});

test('roomsOf finds 1 room of 3 in i001', () => {
  const rooms = roomsOf(parseLevel(I001));
  assert.ok(rooms);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].boxes.length, 3);
  assert.equal(rooms[0].goals.length, 3);
});

test('roomsOf finds 2 rooms of 4 in i003', () => {
  const rooms = roomsOf(parseLevel(I003));
  assert.ok(rooms);
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map((r) => r.boxes.length), [4, 4]);
  assert.deepEqual(rooms.map((r) => r.goals.length), [4, 4]);
});

test('solveLevel solves i001 in P* = 13 pushes', () => {
  const r = solveLevel(parseLevel(I001));
  assert.ok(r);
  assert.equal(r.pushes, 13);
  assert.equal(replay(parseLevel(I001), r.moves).solved, true);
});

test('solveLevel solves i003 in P* = 29 pushes', () => {
  const r = solveLevel(parseLevel(I003));
  assert.ok(r);
  assert.equal(r.pushes, 29);
  assert.equal(replay(parseLevel(I003), r.moves).solved, true);
});

test('solveLevel is deterministic on i003', () => {
  const a = solveLevel(parseLevel(I003));
  const b = solveLevel(parseLevel(I003));
  assert.ok(a && b);
  assert.equal(a.moves, b.moves);
});
