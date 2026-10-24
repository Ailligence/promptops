import { SessionsGuideStep } from './sessions-guide.model';

/**
 * The choreographed demo, played on a dedicated mock session
 * (see SessionsGuideMockService). Each step's index drives the mock phase:
 *   0 new-workspace button → 1 workspace open → 2 main session →
 *   3 spawn composer (typing) → 4 sub-agents (3 streaming terminals).
 *
 * Sub-agents are the hero: the main session is intentionally framed as the
 * control room, the real leverage is the parallel squad.
 */
export const SESSIONS_GUIDE_STEPS: SessionsGuideStep[] = [
  {
    target: '.sg-mock-new-workspace',
    titleKey: 'SESSIONS_GUIDE.newWorkspace.title',
    descriptionKey: 'SESSIONS_GUIDE.newWorkspace.desc',
    position: 'bottom',
  },
  {
    target: '.sg-mock-workspace',
    titleKey: 'SESSIONS_GUIDE.workspace.title',
    descriptionKey: 'SESSIONS_GUIDE.workspace.desc',
    position: 'bottom',
  },
  {
    target: '.sg-mock-main',
    titleKey: 'SESSIONS_GUIDE.mainSession.title',
    descriptionKey: 'SESSIONS_GUIDE.mainSession.desc',
    position: 'right',
  },
  {
    target: '.sg-mock-composer',
    titleKey: 'SESSIONS_GUIDE.spawn.title',
    descriptionKey: 'SESSIONS_GUIDE.spawn.desc',
    position: 'left',
  },
  {
    target: '.sg-mock-agents',
    titleKey: 'SESSIONS_GUIDE.subAgents.title',
    descriptionKey: 'SESSIONS_GUIDE.subAgents.desc',
    position: 'top',
    hero: true,
    actionKey: 'SESSIONS_GUIDE.subAgents.action',
    action: 'createSession',
  },
];
