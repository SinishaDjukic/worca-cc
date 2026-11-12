**You exit before the tasks start.** Put every cross-task fact (who owns a shared file, an interface two tasks
share) in the task files; a bus message from you would reach no one. List each task's files under
`## Files you may touch` as `- Create:` / `- Modify:` bullets with repo-relative paths: the hook reads that list to
announce edits outside it.
