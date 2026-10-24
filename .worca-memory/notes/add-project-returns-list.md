---
name: add-project-returns-list
description: Read before writing a test that registers a project with addProject from src/core/projects.mjs
paths: test/**/*.test.mjs, src/core/projects.mjs
updated: 2026-10-03T13:01:04.550Z
author: Bulibas
---

`addProject(input)` in `src/core/projects.mjs` does NOT return the new project row. It returns `listProjects()`,
the array of every registered project. So `const p = await addProject(...); p.key` gives `undefined` with no error.
A plan snippet that writes it this way looks correct and only fails at runtime.

Use the house pattern instead: `const [project] = await addProject(...)` in a fresh temp home
(see `test/ask-mcp-stdio.test.mjs:116`). Or pick the row by name:
`(await addProject({ name, path })).find((x) => x.name === name)`.
