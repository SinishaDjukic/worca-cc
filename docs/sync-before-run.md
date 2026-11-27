# Sync before run

Before a run starts, Worca can bring the source branch up to date with the remote, so the run begins from the latest code. Most of the time this happens quietly. This page covers the case where it cannot: your local branch has commits the remote does not have, and the remote has commits you do not have. Worca calls that **Diverged**, and it will not merge, reset or overwrite your branch to resolve it.

**Where to find it:** the **Branches** table on the New run form, the **Projects** list, and **Settings › Runs › Sync before run**. The **Branches** table and the Settings card show at the Advanced level and above (see [ui-levels.md](ui-levels.md)); the Projects list shows its sync bar and the **Diverged** card at every level. All of them apply only to a project with a git remote.

## What the status words mean

Each project in the Projects list shows how its source branch compares with the remote (the New run pill says
**N behind** and **Offline** for short):

- **Up to date**: nothing to do.
- **N commits behind**: the remote has newer commits. A run fetches them first and moves your branch forward when that is safe.
- **Diverged**: both sides have new commits.
- **Can’t reach origin**: the remote could not be reached, so Worca uses the last fetch. The row says when that
  was (**Last fetched …**) and offers **Retry**.
- **Not on origin yet**: the branch exists only on your machine, so a run uses your local copy.

A project with uncommitted changes also says so. Runs use committed code only, so those changes are not part of the run.

## When both sides moved

On the New run form, the **Branches** table has a row for the project. Under **Use branches from**, the choice is **Origin · latest** or **Local copy**. With **Origin · latest** and a diverged branch, the row reads "Your N unpushed commits are left out" and tells you to use **Local copy** if you want them in. With **Local copy**, the row reads "Includes your N unpushed commits" and notes how many newer commits on the remote the run misses.

When you click start on a diverged branch and the project is set to ask, a card opens with the heading "`<branch>` has diverged from `<remote>/<branch>`". It states how many commits you are ahead and behind. Pick one of:

- **Start from `<remote>/<branch>`**: the run starts from the remote. Your local branch and your shared folder stay untouched, and your unpushed commits are not in the run. The card marks this as recommended.
- **Cancel**: nothing starts, and a "Start cancelled" notice appears.

If the project's setting does not allow starting from the remote, the card says so and only **Cancel** is left. For a workspace, the card lists each diverged project on its own line.

To get your commits into a run, push them first, or choose **Local copy** on the form.

## Choose what happens by default

The **If the source branch has diverged** setting has three choices:

- **Ask me**: show the card above.
- **Start from origin**: start from the remote without asking.
- **Don't run**: refuse to start. The row says "Can’t start from origin" and asks you to push your commits or use **Local copy**.

Set it for every project in **Settings › Runs › Sync before run**, or for one project in the **This project** section of its sync dialog, where **Default** follows the setting from Settings. That section also has **Sync before run** (On or Off). The Settings card adds **Sync the source branch before each run**, **Remote** and **Check remotes in the background**.

A scheduled run cannot ask. With **Ask me**, a scheduled run starts from origin. The schedule sheet has its own **If the base has diverged** choice (**Project setting**, **Start from origin** or **Don't run**) and an **Auto-sync before the run** switch.

## Sync by hand

Click **Review…** on a diverged project to open its sync dialog. It shows the local base, the remote tip, how many commits you are behind and ahead, when the remote was last fetched, and the state of the working tree. Click **Sync** to fetch and move the branch forward when that is safe. For a diverged branch the dialog says "Nothing was moved". If the remote cannot be reached, the button reads **Retry**.

## After a run starts

A run that synced shows a button on its header. It reads **Synced N commits**, **From origin** (the run started from the remote), **Used last fetch** or **Diverged**. Click it to show the Sync log.

## Related

- [projects.md](projects.md): the Projects list and each project's page.
- [scheduled-runs.md](scheduled-runs.md): starting a run later.
- [runs.md](runs.md): what a run gives you while it runs and after it ends.
- [ui-levels.md](ui-levels.md): which controls show at each level.
