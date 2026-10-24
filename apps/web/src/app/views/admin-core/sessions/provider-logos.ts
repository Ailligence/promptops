import { PROVIDER_LOGOS } from './services/spawn-providers.const';

/** Logo of each provider, shared by the session sidebar and the floor plan.
 *  Same map as the spawn chip: grok, hermes, Z.AI and Kimi sessions used to fall
 *  back to the plain terminal icon. */
export const PROVIDER_LOGO: Record<string, string> = PROVIDER_LOGOS;
