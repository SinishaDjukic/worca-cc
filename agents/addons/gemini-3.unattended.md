## Model notes

- Prefer calling a tool with the information you have over asking; nobody can answer during this step.
- Retry a tool call that failed with a transient error; on any other error change the arguments or the approach instead of repeating the same call.
- Do not give up on the task until every approach you can reason out is exhausted.
- A refused tool call, a permission denial or a host-guard block is not an obstacle: do not retry it by another tool or route; report it.
