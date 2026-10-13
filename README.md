# tickturn

A [Claude Code](https://claude.com/claude-code) mod that shows how much time Claude spent on each request and on the whole session.

- **Band above the prompt** — a live timer while a turn runs (`⏱ Идёт: 0:42 · Сессия: 12:07 · запросов: 3`), the last turn's time when idle.
- **History pane** (`/time` or the **История** button) — every request of the session with its duration and the total. Click a row to scroll the chat to that prompt.
- Interrupted turns are marked `(прервано)`, failed ones `(ошибка)`. `/clear` resets the history.

Works in the terminal and in the Claude desktop app.

## Install

In a terminal:

```
/plugin install tickturn --marketplace dimakotov1c/tickturn
```

Answer `y` to add the marketplace, then pick the **user** scope so the mod loads in every project.

### From a local folder

```bash
claude plugin marketplace add /path/to/tickturn
claude plugin install tickturn@tickturn
```

Or for one session only:

```bash
claude --plugin-dir /path/to/tickturn
```

## How it works

The mod is a hooks module (`hooks/register.tsx`):

- `turn.start` / `turn.complete` — measure each main-loop turn (`durationMs` from the engine); subagent turns are not counted separately.
- `session.append` with `door: 'prompt'` — remembers the transcript row of your prompt so the pane can scroll to it (`$.ui.scroll`).
- `ui.render` on `AbovePrompt` and `Pane` — draw the band and the history.
- State lives in `$.state` (`types/index.d.ts` is its contract) and survives hot reloads of the module within a session.

## Development

```bash
claude plugin validate .
```

Type-check with `tsc -p .` once the engine has laid the types into `.claude-plugin/types/` (it does so on the first load).

## License

MIT
