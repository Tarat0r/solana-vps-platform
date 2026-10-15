# Architecture diagrams

PlantUML `.puml` files are the editable sources. [Architecture.md](../../Architecture.md) embeds their SVGs and links to each source.

The overview, off-chain/on-chain components and state, payment sequence, and SSH login sequence describe the reduced target product, with implemented/planned status called out. `ssh-components.puml` documents the existing PAM/daemon implementation and its fixture boundaries. The historical `billing-and-provisioning` filename is retained for links; its content now covers payment and access on an already prepared server.

Keep all diagrams aligned with the owner dashboard, thin authentication gateway, operator-run provider Bash script, and existing SSH enforcement. A dedicated provider CLI is outside the MVP scope. There is no order database or payment-triggered provisioning flow.

After editing a source, regenerate and validate all SVGs from the repository root:

```sh
bash scripts/render-diagrams.sh
```

Requires Bash, PlantUML (with Java), and Graphviz, with `plantuml` and `dot` on `PATH`. The existing renderer runs locally without a display server, validates every diagram before replacing SVGs, and gives them a white background for readability.

Commit the PlantUML source, updated SVG, and Markdown together. When adding a diagram, add a uniquely named `.puml` source and matching SVG link in `Architecture.md`. Check rendered labels and connections as well as Markdown links.
