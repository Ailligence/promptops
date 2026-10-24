// A button in the toolbar of each agent terminal.
// The plugin never talks to an agent: it answers the click with ONE proposal and
// PromptOps carries it out, asking the person first when it sends a prompt.
//
// ctx: { sessionId, sessionName, provider, status, workspaceName, paneAgentId,
//        agents: [{ id, name, slug, provider, status, isMain }] }
//
// Possible answers (see PLUGIN_GUIDE.md, "Session buttons"):
//   { prompt: text, target }   send a prompt to an agent (default: the agent of this terminal)
//   { insert: text }           paste text into the agent input, without Enter
//   { spawn: { prompt, provider, mode, name } }   prefill a new sub-agent
//   { panel: view }            show a read-only window
//   { toast: text }            show a notification

promptops.session.registerButtons({
  async action(buttonId, ctx) {
    if (buttonId !== 'run') return { toast: 'Unknown button: ' + buttonId };
    // Starter behavior: ask the agent of this terminal for a short summary. Replace it.
    return {
      prompt: 'Summarize what you did so far in this session in 5 short bullet points.',
      target: ctx.paneAgentId,
    };
  },
});
