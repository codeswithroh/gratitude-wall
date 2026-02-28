import Phaser from 'phaser';

const GRID_SIZE = 20;
const CELL_SIZE = 30;
const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;

const TARGET_SCORE = 100;
const START_TIME = 90; // seconds

const FOOD_TYPES = {
  normal: { color: 0xf5f5f5, value: 3 },
  shield: { color: 0x4aa8ff, value: 8 },
  fraud: { color: 0xf5c542, value: 10 },
  jam: { color: 0xff6b6b, value: 8 },
  drain: { color: 0x22c55e, value: 6 },
};

const LEDGER_ICON_BASE = 'https://crypto-icons.ledger.com';

const ETH = { name: 'Ethereum', key: 'ethereum', ledgerId: 'ethereum' };

const L2S = [
  { name: 'Arbitrum', key: 'arbitrum', ledgerId: 'arbitrum', type: 'fraud' },
  { name: 'Optimism', key: 'optimism', ledgerId: 'optimism', type: 'jam' },
  { name: 'Base', key: 'base', ledgerId: 'base', type: 'normal' },
  { name: 'zkSync', key: 'zksync', ledgerId: 'zksync', type: 'shield' },
  { name: 'Starknet', key: 'starknet', ledgerId: 'starknet', type: 'drain' },
  { name: 'Linea', key: 'linea', ledgerId: 'linea', type: 'normal' },
  { name: 'Scroll', key: 'scroll', ledgerId: 'scroll', type: 'shield' },
];

const POWERED_TYPES = ['shield', 'fraud', 'jam', 'drain'];
const POWERUP_GLYPH = null;

export function createGame({ mountId, onScore, onTime, onSecurity, onLastL2, onGameOver, onWin }) {
  let snake = [];
  let direction = { x: 1, y: 0 };
  let nextDirection = { x: 1, y: 0 };
  let moveTimer;
  let speed = 140;
  let foods = [];
  let score = 0;
  let timeLeft = START_TIME;
  let isPaused = false;
  let isGameOver = false;
  let graphics;
  let reverseUntil = 0;
  let stunUntil = 0;
  let poweredEatTimes = [];
  let lastL2 = '—';
  let sceneRef;
  let headSprite;

  const config = {
    type: Phaser.AUTO,
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    parent: mountId,
    backgroundColor: '#0b0f1a',
    scene: { preload, create, update },
  };

  const game = new Phaser.Game(config);

  function preload() {
    this.load.on('loaderror', (file) => {
      console.warn(`Failed to load icon: ${file.key} (${file.src})`);
    });
  }

  function create() {
    sceneRef = this;
    graphics = this.add.graphics();
    loadLedgerIcons(this);

    this.input.keyboard.on('keydown', (event) => handleInput(event));
    this.input.keyboard.on('keydown-P', () => togglePause());
    this.input.keyboard.on('keydown-R', () => start());

    moveTimer = this.time.addEvent({
      delay: speed,
      loop: true,
      callback: () => step(this),
    });

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => tickTimer(),
    });
  }

  function update() {
    if (isGameOver) return;
    draw();
  }

  function start() {
    if (!sceneRef) return;
    foods.forEach((food) => food.sprite && food.sprite.destroy());
    foods = [];
    if (headSprite) headSprite.setVisible(false);

    snake = [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    timeLeft = START_TIME;
    speed = 140;
    isPaused = false;
    isGameOver = false;
    reverseUntil = 0;
    stunUntil = 0;
    poweredEatTimes = [];
    lastL2 = '—';

    onScore?.(score);
    onTime?.(timeLeft);
    onSecurity?.('Stable');
    onLastL2?.(lastL2);

    for (let i = 0; i < 4; i++) spawnFood(sceneRef);
  }

  function pause() { isPaused = true; }
  function resume() { isPaused = false; }
  function togglePause() { isPaused = !isPaused; }

  function applyDirection(desired) {
    const reverse = performance.now() < reverseUntil;
    let next = desired;
    if (reverse) next = { x: -desired.x, y: -desired.y };
    if (next.x + direction.x === 0 && next.y + direction.y === 0) return;
    nextDirection = next;
  }

  function handleInput(event) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }
    const key = event.key.toLowerCase();

    const map = {
      arrowup: { x: 0, y: -1 },
      w: { x: 0, y: -1 },
      arrowdown: { x: 0, y: 1 },
      s: { x: 0, y: 1 },
      arrowleft: { x: -1, y: 0 },
      a: { x: -1, y: 0 },
      arrowright: { x: 1, y: 0 },
      d: { x: 1, y: 0 },
    };

    if (!map[key]) return;
    event.preventDefault();

    applyDirection(map[key]);
  }

  function step(scene) {
    if (isPaused || isGameOver) return;
    if (performance.now() < stunUntil) return;
    if (snake.length === 0) return;

    direction = nextDirection;
    const head = snake[0];
    const newHead = { x: head.x + direction.x, y: head.y + direction.y };

    if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE) {
      return gameOver('Hit the wall.');
    }

    if (snake.some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
      return gameOver('Hit yourself.');
    }

    snake.unshift(newHead);

    let ate = false;
    for (let i = 0; i < foods.length; i++) {
      const food = foods[i];
      if (food.x === newHead.x && food.y === newHead.y) {
        ate = true;
        resolveEat(scene, food);
        foods.splice(i, 1);
        if (food.sprite) food.sprite.destroy();
        spawnFood(scene);
        break;
      }
    }

    if (!ate) {
      snake.pop();
    }

    verifyFraudProof(newHead);
  }

  function resolveEat(scene, food) {
    const type = food.type;
    const now = performance.now();

    if (type === 'fraud' && !food.verified) {
      return gameOver('A fraud-proof L2 was eaten before verification.');
    }

    score += FOOD_TYPES[type].value;
    lastL2 = food.name;
    onScore?.(score);
    onLastL2?.(lastL2);

    if (POWERED_TYPES.includes(type)) {
      poweredEatTimes.push(now);
      poweredEatTimes = poweredEatTimes.filter((t) => now - t < 15000);
      if (poweredEatTimes.length >= 3) {
        return gameOver('Security collapse: too many powered L2s in a short window.');
      }
    }

    if (type === 'shield') {
      stunUntil = now + 2000;
    }

    if (type === 'jam') {
      reverseUntil = now + 3000;
    }

    if (type === 'drain') {
      const loss = Math.min(3, snake.length - 2);
      snake.splice(snake.length - loss, loss);
    }

    if (score >= TARGET_SCORE) {
      return winGame();
    }

    adjustDifficulty();
    updateSecurityHud();
  }

  function verifyFraudProof(head) {
    foods.forEach((food) => {
      if (food.type !== 'fraud' || food.verified) return;
      const dist = Math.abs(food.x - head.x) + Math.abs(food.y - head.y);
      if (dist === 1) {
        food.verified = true;
      }
    });
  }

  function spawnFood(scene) {
    if (foods.length >= 5) return;
    if (!scene) return;
    let spot;
    let tries = 0;
    do {
      spot = {
        x: Phaser.Math.Between(0, GRID_SIZE - 1),
        y: Phaser.Math.Between(0, GRID_SIZE - 1),
      };
      tries++;
    } while (isOccupied(spot) && tries < 200);

    if (tries >= 200) return;
    const l2 = randomL2();
    let sprite;
    if (scene.textures.exists(l2.key)) {
      sprite = scene.add.image(
        spot.x * CELL_SIZE + CELL_SIZE / 2,
        spot.y * CELL_SIZE + CELL_SIZE / 2,
        l2.key
      );
      sprite.setDisplaySize(CELL_SIZE * 0.7, CELL_SIZE * 0.7);
    } else {
      sprite = scene.add.circle(
        spot.x * CELL_SIZE + CELL_SIZE / 2,
        spot.y * CELL_SIZE + CELL_SIZE / 2,
        CELL_SIZE * 0.3,
        FOOD_TYPES[l2.type].color
      );
    }
    sprite.setDepth(1);

    foods.push({
      ...spot,
      name: l2.name,
      type: l2.type,
      key: l2.key,
      verified: false,
      sprite,
    });
  }

  function randomL2() {
    const powerChance = Math.min(0.2 + score / 200, 0.6);
    const allowPowered = Math.random() < powerChance;
    const pool = allowPowered ? L2S : L2S.filter((l2) => l2.type === 'normal');
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async function loadLedgerIcons(scene) {
    try {
      const res = await fetch(`${LEDGER_ICON_BASE}/index.json`);
      if (!res.ok) throw new Error(`icon index ${res.status}`);
      const index = await res.json();
      [ETH, ...L2S].forEach((token) => {
        const entry = index[token.ledgerId] || index[token.name.toLowerCase()];
        if (!entry || !entry.icon) return;
        const url = `${LEDGER_ICON_BASE}/${entry.icon}`;
        scene.load.image(token.key, url);
      });
      if (scene.load.list.size > 0) {
        await new Promise((resolve) => {
          scene.load.once('complete', resolve);
          scene.load.start();
        });
      }
    } catch (err) {
      console.warn('Ledger icons unavailable, using fallback dots.', err);
    }
  }

  function isOccupied(pos) {
    if (snake.some((seg) => seg.x === pos.x && seg.y === pos.y)) return true;
    if (foods.some((food) => food.x === pos.x && food.y === pos.y)) return true;
    return false;
  }

  function tickTimer() {
    if (isPaused || isGameOver) return;
    timeLeft -= 1;
    if (timeLeft <= 0) {
      return gameOver('Time ran out.');
    }
    onTime?.(timeLeft);
  }

  function adjustDifficulty() {
    if (score >= 70) speed = 90;
    else if (score >= 40) speed = 110;
    else speed = 140;
    if (moveTimer) moveTimer.delay = speed;
  }

  function updateSecurityHud() {
    const now = performance.now();
    const danger = poweredEatTimes.filter((t) => now - t < 15000).length;
    const status = danger >= 2 ? 'Shaky' : 'Stable';
    onSecurity?.(status, danger);
  }

  function draw() {
    if (!graphics) return;
    graphics.clear();

    graphics.fillStyle(0x0e1322, 1);
    graphics.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    graphics.lineStyle(1, 0x141a2d, 1);
    for (let i = 0; i <= GRID_SIZE; i++) {
      graphics.lineBetween(i * CELL_SIZE, 0, i * CELL_SIZE, CANVAS_SIZE);
      graphics.lineBetween(0, i * CELL_SIZE, CANVAS_SIZE, i * CELL_SIZE);
    }

    foods.forEach((food) => {
      const centerX = food.x * CELL_SIZE + CELL_SIZE / 2;
      const centerY = food.y * CELL_SIZE + CELL_SIZE / 2;

      if (food.sprite) {
        food.sprite.setPosition(centerX, centerY);
        if (food.sprite.setDisplaySize) {
          food.sprite.setDisplaySize(CELL_SIZE * 0.7, CELL_SIZE * 0.7);
        }
      }

      if (food.type === 'normal') return;
      let ringColor = FOOD_TYPES[food.type].color;
      if (food.type === 'fraud' && food.verified) ringColor = 0x22c55e;
      graphics.lineStyle(3, ringColor, 1);
      graphics.strokeCircle(centerX, centerY, CELL_SIZE * 0.44);
      graphics.lineStyle(1, ringColor, 0.5);
      graphics.strokeCircle(centerX, centerY, CELL_SIZE * 0.52);
    });

    snake.forEach((seg, index) => {
      if (index === 0) return;
      const color = 0x1f6f8b;
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(
        seg.x * CELL_SIZE + 2,
        seg.y * CELL_SIZE + 2,
        CELL_SIZE - 4,
        CELL_SIZE - 4,
        6
      );
    });

    const head = snake[0];
    if (head) {
      if (!headSprite && sceneRef) {
        headSprite = sceneRef.textures.exists(ETH.key)
          ? sceneRef.add.image(0, 0, ETH.key)
          : sceneRef.add.circle(0, 0, CELL_SIZE * 0.35, 0x7ef0ff);
        headSprite.setDepth(2);
        if (headSprite.setDisplaySize) headSprite.setDisplaySize(CELL_SIZE * 0.8, CELL_SIZE * 0.8);
      }
      if (headSprite) {
        headSprite.setPosition(
          head.x * CELL_SIZE + CELL_SIZE / 2,
          head.y * CELL_SIZE + CELL_SIZE / 2
        );
        headSprite.setVisible(true);
      }
    } else if (headSprite) {
      headSprite.setVisible(false);
    }
  }

  function gameOver(reason) {
    isGameOver = true;
    onGameOver?.(reason, score);
  }

  function winGame() {
    isGameOver = true;
    onWin?.(score);
  }

  function destroy() {
    try { game.destroy(true); } catch { /* ignore */ }
  }

  return { start, pause, resume, destroy, setDirection: applyDirection };
}

export const GAME_CONSTANTS = {
  TARGET_SCORE,
  START_TIME,
};
