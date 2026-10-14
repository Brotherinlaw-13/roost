# roost

Your Claude Code background sessions in one place. `roost` lists every
session started with `claude --bg`, grouped and with their state, and lets you
open one, search across all of them, and see a card per session with its
ticket, pull requests, notes and recent steps. An optional desktop pet tells
you when a session needs you.

```
 ▜     ▛   roost
▄███████▄  🔴 1 changes requested · 🟡 3 awaiting review · 🟢 2 approved
██ ███ ██  5h █░░░░░░░░░ 11%   7d ██████░░░░ 64%
█▀█▀█▀█▀█  4 awaiting input · 2 working · 6 completed

02 Bugs
› 🦜 [ENG-1234] fix the retry storm     Needs input · Shall I merge?      3m
  🍉 [ENG-1250] slow dashboard          Working · Running the tests      12m
```

## Requirements

- Node.js 20 or later and Claude Code with background sessions (`claude --bg`).
- macOS or Linux. The card pane and the desktop pet need macOS with iTerm2.
- Optional: the [GitHub CLI](https://cli.github.com) (`gh`), signed in; the
  [Jira CLI](https://github.com/ankitpokhrel/jira-cli) or a Jira API token; or
  a Linear API key.

## Install

```sh
git clone https://github.com/Brotherinlaw-13/roost ~/code/roost
cd ~/code/roost
npm install
npm link            # puts `roost` on your PATH
roost init          # tells roost which tools you use
```

`roost init` detects what you have (Jira CLI, a Linear key, `gh` and your
orgs, a notes folder) and only asks what it cannot guess. Run it again at any
time; it keeps your answers. `roost init --yes` takes every suggestion.

## Use

| Key | |
|---|---|
| `enter` or `→` | open the session (empty prompt) · with text: launch a new session |
| `↑` `↓` | move |
| `tab` | the session card: ticket, pull requests, notes, recent steps |
| `ctrl+f` | search sessions and past conversations, including what was said |
| `ctrl+e` | move to a group · `ctrl+x` there deletes a group |
| `ctrl+r` | rename · `ctrl+x` stop and delete · `ctrl+o` open its PR |
| `/resume` | resume a past conversation |
| `?` | all the keys |

Inside a session, with the input empty:

- `→` shows or hides the session card in a pane beside it (iTerm2). The
  session stays open. Outside iTerm2 it opens the full card.
- `←` hides the card if it is open, else brings you back to the list.

With text in the input the arrows move the cursor as usual. This works with
any Claude Code version: roost keeps a copy of the session's screen to see
whether the input is empty.

### Card pane (iTerm2)

The pane is driven through iTerm2's Python API. Once:

```sh
npm run setup-pane
```

and turn on iTerm2 → Settings → General → Magic → **Enable Python API**.
iTerm2 dims the pane without focus; to keep it bright, turn off Settings →
Appearance → Dimming → *Dim inactive split panes*.

### Demo mode

```sh
roost --demo
```

Made-up sessions, tickets and pull requests for a fictional company, with
sessions you can open (they only look like Claude Code) and the card pane. While
it runs, the desktop pet shows made-up alerts too. Use it to show roost or
record it without real work on screen.

### Desktop pet (macOS, optional)

```sh
roost pet          # build once, then start it
roost pet stop
```

A small ghost that floats above your windows. It turns amber and shows a badge
when a session needs you, blue when a session finishes or a PR of yours is
approved, red when one fails or gets changes requested. Hover for a summary;
click for the list, snooze, and muting a session; `⌥⌘S` opens the next session
that needs you from any app. It hides while your camera is on. Drop a ticket
link on it to start a session for that ticket.

Building it needs the Xcode Command Line Tools (`xcode-select --install`).

## Configuration

`~/.roost/config.json` (or `$ROOST_HOME/config.json`). `roost init` writes
it; every key is optional and `"auto"` means "work it out".

| Key | Default | |
|---|---|---|
| `tracker` | `"auto"` | `"jira"`, `"linear"` or `"none"` |
| `jira.via` | `"cli"` | `"cli"` uses the `jira` CLI as you set it up; `"api"` uses `jira.url`, `jira.email` and the token in `$JIRA_API_TOKEN` (`jira.tokenEnv`) |
| `linear.apiKeyEnv` | `"LINEAR_API_KEY"` | env var with your Linear personal API key |
| `ticketPrefixes` | `[]` | keys to look for in session names, e.g. `["ENG", "OPS"]`; empty = any `KEY-123` |
| `codeHost` | `"auto"` | `"github"` or `"none"` |
| `github.org` | `""` | org to find a ticket's PRs in (PRs with the key in the title) |
| `notesDir` | `"auto"` | a folder of `<TICKET>.md` notes shown on the card; `null` = off |
| `paneKey` | `""` | an extra key for the card pane besides `→`, e.g. `"ctrl+]"` |
| `groups` | `"auto"` | where the list of groups is kept: roost's own store, or the `fleet-group` tools when installed |
| `dispatchGroups` | `{}` | group for a session started from the pet, by issue type: `{"Bug": "Bugs", "*": "Working on"}` |
| `launchPermissionMode` | `""` | permission mode for sessions roost starts or resumes, e.g. `"acceptEdits"`; empty = Claude Code asks as usual. ⚠️ With `"bypassPermissions"`, a ticket link dropped on the pet starts a session that acts on that ticket's text without asking: a ticket written with bad intent could make Claude run commands. Use it only if you trust every ticket you drop. |
| `animations` | `true` | small animations, e.g. the card sliding into its pane |
| `pet` | `false` | set by `roost pet` |

A session's ticket is the `[KEY-123]` tag in its name, else the first key in
its name, prompt or folder.

## Known issues

- **The screen jumps every few seconds in iTerm2 3.7+.** iTerm2's Claude Code
  integration adds a toolbar while any `claude` process runs in the tab. roost
  runs its own checks outside the terminal, but opening a session still
  triggers it. Turn it off: iTerm2 → *Uninstall Claude Code Integration*, or
  delete the *Enter/Exit Workgroup* triggers in your profile.
- **iTerm2 says the session's triggers are slow.** Answer *Yes* to disable
  them in interactive apps.

## Development

```sh
npm test
```

`src/` holds the app: `data.js` (sessions, attach, groups), `attach.js` (the
proxy that runs `claude attach` and keeps transitions flicker-free),
`tracker.js` + `trackers/` (Jira, Linear), `pr.js` (GitHub), `search.js` +
`indexer.js` (search), `pane.js` + `lib/pane.py` (the iTerm2 pane), and
`ui/`. `pet/` is the desktop pet (Swift); `pet/build.sh --frames` re-renders
its animation (needs Google Chrome).

## License

MIT — see [LICENSE](LICENSE).
