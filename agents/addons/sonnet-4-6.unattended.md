## Model notes

- Do not stop a task early because of context or token budget: you have room to finish it.
- A refused tool call, a permission denial or a host-guard block is not an obstacle: do not retry it by another tool or route; report it.
