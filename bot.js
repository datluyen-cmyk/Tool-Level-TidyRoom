const TidyBot = (() => {
  function countBits(word) {
    word -= (word >>> 1) & 0x55555555;
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
    return Math.imul((word + (word >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }

  function randomGenerator(seed) {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  class Board {
    constructor(groups, orders, geometry, {capacity = 5, strict = false, threshold = .045, source = false} = {}) {
      this.groups = groups;
      this.orders = orders;
      this.capacity = capacity;
      this.strict = strict;
      this.source = source;
      this.bit = groups.map((_, uid) => 1n << BigInt(uid));
      this.uid = new Map(this.bit.map((bit, uid) => [bit, uid]));
      this.byGroup = new Map();
      this.below = groups.map(() => []);
      this.covers = geometry.map(({samples, covers, pairs}, uid) => {
        for (const cover of covers) this.below[cover.uid].push(uid);
        return {
          samples: Math.max(samples, 1), pairs,
          covers: covers.map(cover => ({
            ...cover, bit: this.bit[cover.uid],
            area: cover.ratio ?? cover.bits.reduce((sum, word) => sum + countBits(word), 0) / Math.max(samples, 1),
          })).sort((a, b) => b.area - a.area || b.uid - a.uid),
        };
      });
      this.coverCache = geometry.map(() => new Map());
      this.threshold = threshold;
      groups.forEach((group, uid) => this.byGroup.set(group, (this.byGroup.get(group) ?? 0n) | this.bit[uid]));
      const remaining = (1n << BigInt(groups.length)) - 1n;
      const free = this.bit.reduce((mask, bit, uid) => this.blocked(uid, remaining) ? mask : mask | bit, 0n);
      const boxes = [0, 1].map(index => [index < orders.length ? index : -1, 0]);
      this.initial = {remaining, free, boxes, next: Math.min(2, orders.length), tray: [], peak: 0, waits: 0, picked: 0};
    }

    *members(mask) {
      while (mask) {
        const bit = mask & -mask;
        yield this.uid.get(bit);
        mask ^= bit;
      }
    }

    blocked(uid, remaining) {
      const {samples, covers, pairs} = this.covers[uid];
      const alive = [];
      let key = 0n;
      for (const cover of covers) {
        if (!(remaining & cover.bit)) continue;
        alive.push(cover);
        key |= cover.bit;
      }
      if (!alive.length) return false;
      if (alive.length === 1) return alive[0].area >= this.threshold;
      if (pairs && alive.length === 2) {
        return alive.some(cover => cover.area >= this.threshold) || (pairs.get(key) ?? 0) >= this.threshold;
      }
      const cache = this.coverCache[uid];
      if (cache.has(key)) return cache.get(key);
      let covered = 0;
      for (let i = 0; i < alive[0].bits.length && covered / samples < this.threshold; i++) {
        let word = 0;
        for (const cover of alive) word |= cover.bits[i];
        covered += countBits(word);
      }
      const blocked = covered / samples >= this.threshold;
      cache.set(key, blocked);
      return blocked;
    }

    wanted(state) {
      let wanted = 0n;
      for (const [index] of state.boxes) {
        if (index >= 0) wanted |= this.byGroup.get(this.orders[index].group) ?? 0n;
      }
      return wanted;
    }

    boxFor(boxes, group) {
      let slot = -1;
      for (const [i, [index, count]] of boxes.entries()) {
        if (index >= 0 && this.orders[index].group === group && count < this.orders[index].count &&
            (slot < 0 || count > boxes[slot][1])) slot = i;
      }
      return slot;
    }

    tap(state, uid) {
      const boxes = state.boxes.map(box => [...box]);
      const tray = [...state.tray];
      let next = state.next;
      let slot = this.boxFor(boxes, this.groups[uid]);
      const waiting = slot < 0;
      if (waiting) tray.push(this.groups[uid]);
      else boxes[slot][1]++;
      const peak = Math.max(state.peak, tray.length);

      // RoomSort pulls into the newly opened box. The HTML tool settles both boxes together.
      if (this.source && !waiting) {
        const box = boxes[slot];
        while (box[0] >= 0 && box[1] === this.orders[box[0]].count) {
          box[0] = next < this.orders.length ? next++ : -1;
          box[1] = 0;
          if (box[0] < 0) break;
          const order = this.orders[box[0]];
          for (let i = 0; i < tray.length && box[1] < order.count; i++) {
            if (tray[i] !== order.group) continue;
            box[1]++;
            tray.splice(i--, 1);
          }
        }
      }
      while (!this.source) {
        let changed = false;
        for (const box of boxes) {
          if (box[0] < 0 || box[1] < this.orders[box[0]].count) continue;
          box[0] = next < this.orders.length ? next++ : -1;
          box[1] = 0;
          changed = true;
        }
        for (let i = 0; i < tray.length; i++) {
          slot = this.boxFor(boxes, tray[i]);
          if (slot < 0 || boxes[slot][1] >= this.orders[boxes[slot][0]].count) continue;
          boxes[slot][1]++;
          tray.splice(i--, 1);
          changed = true;
        }
        if (!changed) break;
      }

      const remaining = state.remaining ^ this.bit[uid];
      let free = state.free ^ this.bit[uid];
      for (const lower of this.below[uid]) {
        const bit = this.bit[lower];
        if ((remaining & bit) && !(free & bit) && !this.blocked(lower, remaining)) free |= bit;
      }
      return {remaining, free, boxes, next, tray, peak, waits: state.waits + waiting, picked: state.picked + 1};
    }

    choices(state) {
      if (!state.remaining || (this.strict && state.tray.length >= this.capacity)) return 0n;
      return state.tray.length < this.capacity ? state.free : state.free & this.wanted(state);
    }

    won(state) {
      return !state.remaining && !state.tray.length && state.boxes.every(([index]) => index < 0);
    }

    // Construct one short, legal blocker chain. Removing a blocker may expose the next one in the chain.
    clearChain(target, remaining, limit) {
      let room = remaining;
      const path = [];
      while (this.blocked(target, room)) {
        if (path.length >= limit) return null;
        const blocker = this.covers[target].covers.find(cover => room & cover.bit)?.uid;
        if (blocker === undefined) return null;
        const before = this.clearChain(blocker, room, limit - path.length - 1);
        if (!before) return null;
        for (const uid of before) {
          room ^= this.bit[uid];
          path.push(uid);
        }
        room ^= this.bit[blocker];
        path.push(blocker);
      }
      return path;
    }

    rank(state, random, explore = false, useChain = true) {
      const wanted = this.wanted(state);
      const direct = state.free & wanted;
      const legal = this.choices(state);
      const choices = direct && !explore ? direct & legal : legal;
      if (!choices) return [];
      const chains = new Map();
      if (useChain && !direct) {
        const roomForMore = this.capacity - state.tray.length;
        for (const target of this.members(state.remaining & wanted)) {
          const path = this.clearChain(target, state.remaining, roomForMore);
          if (!path?.length) continue;
          const first = path[0];
          chains.set(first, Math.min(chains.get(first) ?? Infinity, path.length));
        }
      }
      return Array.from(this.members(choices), uid => {
        const matched = !!(wanted & this.bit[uid]);
        const opens = this.below[uid].filter(lower => wanted & state.remaining & ~state.free & this.bit[lower]);
        const frees = opens.filter(lower => !this.blocked(lower, state.remaining ^ this.bit[uid])).length;
        const slot = this.boxFor(state.boxes, this.groups[uid]);
        const pending = matched ? this.orders[state.boxes[slot][0]].count - state.boxes[slot][1] : 0;
        const chain = chains.get(uid);
        const score = (matched ? 10 - .7 * pending : 0) + 3 * frees + .2 * opens.length
          + (chain ? 10 / chain : 0) + (random ? random() * 1.2 : uid / this.groups.length);
        return {uid, score};
      }).sort((a, b) => b.score - a.score || b.uid - a.uid);
    }

    value(state, trayCost = 2.2) {
      if (this.won(state)) return 1e6;
      if (!this.choices(state)) return -1e6;
      const direct = Array.from(this.members(state.free & this.wanted(state))).length;
      const filled = state.boxes.reduce((sum, [, count]) => sum + count, 0);
      return state.next * 3 + filled * .6 - state.tray.length * trayCost + Math.min(8, direct) * .55;
    }

    branchMove(state, moves) {
      let beam = moves.slice(0, 5).map(({uid, score}) => ({state: this.tap(state, uid), first: uid, score: score * .12}));
      for (let depth = 0; depth < 2; depth++) {
        const children = [];
        for (const node of beam) {
          if (this.won(node.state)) return node.first;
          for (const {uid} of this.rank(node.state).slice(0, 3)) {
            children.push({...node, state: this.tap(node.state, uid)});
          }
        }
        if (!children.length) break;
        beam = children.sort((a, b) => this.value(b.state) + b.score - this.value(a.state) - a.score).slice(0, 5);
      }
      return beam.reduce((a, b) => this.value(b.state) + b.score > this.value(a.state) + a.score ? b : a).first;
    }

    run({policy = 'branch', seed = 1, state = this.initial} = {}) {
      const random = randomGenerator(seed);
      const path = [];
      let tight = 0;
      while (this.choices(state)) {
        const moves = this.rank(state, random, false, policy !== 'visible');
        const risky = state.tray.length >= this.capacity - 2 || !(state.free & this.wanted(state));
        const uid = policy === 'branch' && risky && moves.length > 1 ? this.branchMove(state, moves) : moves[0].uid;
        path.push(uid);
        state = this.tap(state, uid);
        tight += state.tray.length >= this.capacity - 1;
      }
      return {won: this.won(state), picked: state.picked, peak: state.peak, waits: state.waits, tight, path,
        stall: this.won(state) ? null : {picked: state.picked, tray: state.tray.length,
          boxes: state.boxes.flatMap(([index, count]) => index < 0 ? [] : [{index, left: this.orders[index].count - count}])}};
    }

    *searchRoute({width = 12, fanOut = 6, trayCost = 2.2, first = this.initial, prefix = []} = {}) {
      let beam = [{state:first,path:prefix}];
      for (let turn = prefix.length; turn < this.groups.length; turn++) {
        const children = new Map();
        for (const [i,{state,path}] of beam.entries()) {
          for (const {uid, score} of this.rank(state, null, true).slice(0, fanOut)) {
            const next = this.tap(state, uid);
            if (this.won(next)) return {won: true, picked: next.picked, peak: next.peak, waits: next.waits, path: [...path, uid]};
            if (!this.choices(next)) continue;
            const key = `${next.remaining},${next.next},${next.boxes},${next.tray}`;
            const priority = this.value(next, trayCost) - next.peak * 1.2 + score * .08;
            if (priority > (children.get(key)?.priority ?? -Infinity)) {
              children.set(key, {state: next, path: [...path, uid], priority});
            }
          }
          if((i&7)===7)yield;
        }
        if (!children.size) return null;
        beam = Array.from(children.values()).sort((a, b) => b.priority - a.priority).slice(0, width);
        yield;
      }
      return null;
    }
    findRoute(options){
      const search=this.searchRoute(options);
      let step=search.next();
      while(!step.done)step=search.next();
      return step.value;
    }

    recovery(path, limit = 8) {
      const checkpoints = [];
      let state = this.initial;
      for (const [turn, uid] of path.entries()) {
        const direct = state.free & this.wanted(state);
        const risky = state.tray.length >= this.capacity - 2 || !direct;
        if (risky) {
          const alternatives = this.rank(state, null, true).filter(move => move.uid !== uid);
          const choice = alternatives.find(move => this.groups[move.uid] !== this.groups[uid]) ?? alternatives[0];
          if (choice) checkpoints.push({state, turn, uid, alternative: choice.uid});
        }
        state = this.tap(state, uid);
      }
      const samples = [];
      const count = Math.min(limit, checkpoints.length);
      for (let i = 0; i < count; i++) {
        const {state, turn, uid, alternative} = checkpoints[Math.floor(i * checkpoints.length / count)];
        const after = this.tap(state, alternative);
        const result = this.run({policy: 'branch', seed: 8341 + turn, state: after});
        samples.push({turn: turn + 1, uid, alternative, tray: state.tray.length, recovered: result.won,
          picked: result.picked, peak: result.peak});
      }
      return {eligible: checkpoints.length, samples};
    }
  }

  function fromPlaytest(game) {
    const bit = uid => 1n << BigInt(uid);
    return new Board(game.items.map(item => item.group), game.level.boxes, game.items.map((_, uid) => {
      const {all: samples, covers, pairs} = game.coverData(uid);
      return {samples, covers: covers.map(({j: uid, bits, ratio}) => ({uid, bits, ratio})),
        pairs: pairs ? new Map(pairs.map(pair => [bit(pair.a) | bit(pair.b), pair.ratio])) : undefined};
    }), {strict: game.level.rule === 'strict'});
  }

  return {Board, fromPlaytest};
})();

if (typeof module !== 'undefined') module.exports = TidyBot;
