# Diagram → Plan

Turn a PlantUML or draw.io diagram into an implementation plan, then let worca refine, implement and review it.

1. Pick the **Diagram → Plan** workflow (`--workflow wf_diagram_plan` on the CLI).
2. Give it the diagram, in any of these ways:
   - attach a `.puml` / `.plantuml` / `.wsd` / `.drawio` / `.xml` file (new-run form, or `--extras path/to/flow.drawio`);
   - or paste an `@startuml … @enduml` block into the prompt.
3. **Clarify** asks about the diagram's gaps first: a decision with no `else`, an unlabelled arrow, a dangling branch, a vague node.
4. **Interpret diagram** writes the plan. Every step traces back to a diagram element (`## Diagram trace`). Then Refine → Implement ⇄ Review run as usual.

Supported kinds: activity/flow, sequence, state, class/component. draw.io: plain `.drawio`/`.xml`, compressed or not (worca writes a readable `<name>.decoded.xml` beside a compressed file). `.drawio.png`/`.drawio.svg` exports are not supported. Export the diagram as `.drawio` first.
