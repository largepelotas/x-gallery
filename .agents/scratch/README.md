# Agent scratch

Working notes agents write for each other. Everything here except this file is
ignored by git.

An orchestrator's context is the scarce resource. When an agent produces more
than a couple of dozen lines, relaying it through the orchestrator costs those
tokens twice - once to receive it, and again on every later turn, because it
stays in the transcript. So the agent writes the bulk here and reports the path;
the next agent reads the file directly.

One file per topic: `<topic>.md`, or `review-<topic>.md` for a review. The
agent that writes it reports the path. The agent that reads it is told the path
explicitly - nobody discovers these by listing the directory.

Files are disposable. Anything that should outlive the task belongs in
`CLAUDE.md`, `DESIGN.md`, or a commit message. If you are reluctant to delete
a scratch file, it is in the wrong place.

Never write real client data, credentials, or confidential content into a
scratch file. The gitignore rule is a backstop against committing it, not
permission to write it down.
