# Architecture diagrams

The `.puml` files in this folder are the PlantUML source for the diagrams. [Architecture.md](../../Architecture.md) links to each source file and displays its generated SVG.

To update a diagram, edit its `.puml` source and regenerate the SVGs from the repository root:

```sh
bash scripts/render-diagrams.sh
```

Requires Bash, PlantUML (with Java), and Graphviz, with `plantuml` and `dot` available on your PATH. Rendering runs locally without a display server. Generated SVGs have a white background to keep labels readable in GitHub's light and dark modes.

Commit the PlantUML source, updated SVG, and Markdown together. When adding a diagram, add a uniquely named `.puml` source and matching SVG link in `Architecture.md`.
