---
name: pet
description: Start, restart, stop or rebuild the roost desktop pet (RoostPet.app). Use when the user types /pet or asks to launch, restart, stop or rebuild the roost pet.
---

Run the roost pet command, non-interactively, and report the one-line result.

Arguments map directly to `roost pet`:

- no args → `roost pet` (starts it, or restarts it if already running)
- `stop` → `roost pet stop`
- `rebuild` or `--rebuild` → `roost pet --rebuild` (needs the Xcode Command Line Tools)

```bash
roost pet $ARGUMENTS
```

Then confirm with `pgrep -x RoostPet` and say whether the pet is running (pid) or stopped. Do not start the interactive `roost` list from a session: it needs a terminal of its own.
