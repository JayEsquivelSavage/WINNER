# WINNER

Competitive auction word-game bot for `winner` (public ID307), built on the Clockwork Labs Scrabblebot game and official dictionary. This repository is a fresh baseline with isolated credentials, telemetry and reports. Previous WORDGOAT outcomes are not WINNER results.

Source and commands live in `bot-starter/`. The saved optimized strategy is the baseline; experimental candidates are not enabled automatically. No strategy guarantees every win.

## Install

```sh
cd spacetimedb
npm ci
cd ../bot-starter
npm ci
npm run build
```

## Play and monitor

In Terminal2, from `bot-starter`, supply a fresh credential locally on the first start (zsh):

```sh
read -s "BOT_TOKEN?Paste your replacement winner token: "
BOT_TOKEN="$BOT_TOKEN" npm start
```

The token is hidden while typing and is saved only after winner/307 is verified. Do not put a credential in a commit or chat. Subsequent starts use the private `.token-winner` file:

```sh
npm start
```

In Terminal3, from the same directory:

```sh
npm run feedback:watch
```

Both commands default to `winner`, ID307. Data: `bot-starter/telemetry/bots/bot-winner/`. Reports: `bot-starter/reports/bots/bot-winner/`. The watcher reads public results and never starts another bot.

## Verify

```sh
npm run build
npm test
npm run test:collector
npm run test:integration
npm run test:startup
npm run test:reconnect
```

Tests and simulations use fixtures or synthetic games and open no live bot socket. Establish WINNER's own live baseline before tuning; evaluate candidates on fresh paired seeds against the actual current strategy. Promotion never happens automatically.

## Attribution

Game module, generated bindings and official dictionary originate from [Clockwork Labs Scrabblebot](https://github.com/clockworklabs/scrabblebot), retained under the included license.

See [WINNER baseline and verification](bot-starter/reports/WINNER-BASELINE.md) for the fresh synthetic results and their limits.
