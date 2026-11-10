---
name: getting-started
description: Turn a new fork or clone of this boilerplate into your own project. Renames the template placeholders, then guides the GitHub setup.
disable-model-invocation: true
---

# Getting started

This repository is a boilerplate. Many values in it are **placeholders** that name the template (`be-monorepo`, `rifandani`, `vaandani`). Your job is to turn the template into the user's project. You make the edits. The user makes the decisions and approves each action on GitHub.

Do the steps in order. Ask one question at a time, with a suggested answer. Edit a file only after the user gives the answer that the edit needs.

## 1. Interview

Get these values. Find a default for each one before you ask.

| Value | Default |
| --- | --- |
| `<project>`, for example `acme-api` | The repository name in `git remote get-url origin` |
| `<owner>/<repo>` | `git remote get-url origin` |
| Author | `git config user.name` |
| Description | None. Ask. |
| Apps to keep | Both `hono` and `effect` |
| Licence | Keep `LICENSE` with the new author as the holder |
| Docs site | No docs site: remove the Mintlify badge |

If `origin` is still `rifandani/be-monorepo`, the user did not make a repository yet. Ask for `<owner>/<repo>`, and tell the user that step 5 needs the repository.

**Done when:** you showed all the values in one summary and the user approved the summary.

## 2. Replace the placeholders

Read [ROOT.md](ROOT.md). Read [HONO.md](HONO.md) and [EFFECT.md](EFFECT.md) only for the apps that the user keeps. Apply each row of each "Placeholders" table.

For an app that the user does not keep: show the user the list of what you will remove (the `apps/<app>` folder, its `portless.json` entry, its root `package.json` scripts, its jobs in `.github/workflows/`, its README links). Remove these only after the user approves the list.

Then do the sweep:

```bash
git grep -n -I -E "be-monorepo|rifandani|Rifandani|vaandani" -- ':!repos' ':!bun.lock' ':!.agents/skills/getting-started'
```

The sweep is the completion test, and the tables are a map of the known places. Replace each result that is not in a table also.

**Done when:** the sweep shows only the lines that the user decided to keep, and you told the user each of these lines.

## 3. Decide on the example code and the documents

Go through each item in the "Decisions" sections of the same files. For each item, tell the user what the item is and what the options are. Then apply the answer. "Keep as it is" is a correct answer.

**Done when:** each item has an answer from the user.

## 4. Verify

```bash
bun install
```

This command also installs the husky git hooks (the `prepare` script). Then run `bun lint`, and the type check and test scripts of each app that the user keeps. Repair what your edits broke.

**Done when:** the install, the lint, the type checks and the tests are all green.

## 5. Set up GitHub

Do the "GitHub" section of [ROOT.md](ROOT.md), one item at a time. Each item changes the user's GitHub repository. Show the exact `gh` command or the exact settings path, and run a command only after the user approves that command. For a secret, the user runs the command, so that the value stays out of this conversation.

**Done when:** each item is done, or the user decided to skip it. Give the user the list of skipped items.

## 6. Clean up

This skill is for one use. Ask the user for approval to delete `.agents/skills/getting-started/` and the "Getting Started" section of the root `README.md`. Then give a summary: the values that you changed, the decisions, and the GitHub items that stay open.
