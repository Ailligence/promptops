---
version: 1
slug: "apps-web"
primary_target: "apps/web"
related_targets: []
---

# Surface brief: PromptOps app (apps/web, whole app)

Mode: Operate. Audience: one developer supervising 3–8 CLI agents for hours across client projects (see PRODUCT.md). Task: see who needs you, step in, go back to watching. Constraint: every feature stays reachable (personal fork, the user uses everything); i18n keys for all copy.

## Direction contract

THESIS: You are the signaller. Every agent is a train on its track; only you can clear a red signal. Refuses the category default of a bootstrap admin with a card grid, triple sidebar and right-hand control panel.

OWN-WORLD: Matte panel enamel (graphite #14171a / #1d2125), track lines drawn in warm off-white #e8ebe6 at 1px, lit signal lamps as the only saturated color: green = working, amber = idle/waiting, red = blocked/needs you, off/struck = exited. Brand violet #4F41FA is "route set": selection, focus, primary action only. Engraved labels: small uppercase Geist with wide tracking for panel labels, Geist Mono tabular for every number. 2–4px radii, no shadows except overlays, separation by rules and planes.

STORY: At a glance the user reads the mimic diagram (client → workspace → session as one track, a lamp per agent); red lamps also surface in a single "needs you" strip; clicking one routes straight to that agent. Everything else is one ⌘K or one overflow away.

FIRST VIEWPORT (structure round, seed e8cc7c5e, chosen "Canvas + Dock"): no global rail, no session tree, no right panel on the session screen. Top: one 36px line (menu · lamp · session name · workspace/branch · Agents · ⌘K). Center: the session's agent terminals edge to edge. Bottom: one 40px dock that merges the old status bar: left the sessions as lamp chips grouped by client (red chips breathe, click routes), a "+" for a new session and a button that slides the full session tree in as a sheet; right the efficiency/commands/⋮ cells. Everything the old toolbars held (Git, DB, Docker, SSH, editor, notes, brief, terminals, links, assets, usage, spawner, pages) is one ⌘K away or in a slide-over sheet. Signature interaction: ⌘K palette that routes to any session, agent, tool or page; lamp warm-up 160ms; reduced-motion static.

FORM: Signal box / CTC mimic panel, position 4 on the ordered list; seed key 61d47a34. Raises: tabular mono numbers (Datamatics); exited agents stay as struck off-lamps (Ticket Wallet); violet only where you act (Consumer); elapsed time as track length (Labanotation); 1px rules, no shadows (Centre Rail).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
