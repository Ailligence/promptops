/**
 * Single source of truth for voice commands.
 * Patterns are matched by VoiceIntentRegistry; descriptions/examples shown
 * by VoiceCommandsGuideModal are looked up in i18n via `i18nKey`.
 *
 * Pattern syntax:
 *   {param}      → free-text capture (greedy to end)
 *   {n}          → integer 1..9 (also accepts spelled-out: "due", "two")
 *   word a|b|c   → alternatives
 *   ?            → not used (regex special chars are escaped)
 *
 * Patterns must be lowercase, no punctuation. Normalization happens upstream.
 */

export type SupportedLang = 'it' | 'en' | 'es' | 'fr' | 'pt';

export type VoiceCommandCategory =
  | 'navigation'
  | 'session'
  | 'focus'
  | 'prompt'
  | 'control';

export type VoiceCommandId =
  | 'nav.sessions'
  | 'nav.workspaces'
  | 'nav.settings'
  | 'nav.ranking'
  | 'nav.back'
  | 'nav.forward'
  | 'session.open'
  | 'session.openByNumber'
  | 'session.next'
  | 'session.previous'
  | 'session.close'
  | 'session.new'
  | 'workspace.open'
  | 'focus.subagent'
  | 'focus.terminal'
  | 'focus.subagentNext'
  | 'focus.subagentPrev'
  | 'focus.listAgents'
  | 'subagent.spawn'
  | 'prompt.send'
  | 'prompt.compose'
  | 'prompt.run'
  | 'prompt.repeat'
  | 'prompt.cancelLast'
  | 'prompt.clear'
  | 'control.cancel'
  | 'control.repeat'
  | 'control.confirm'
  | 'control.reject'
  | 'control.help';

export interface VoiceCommand {
  id: VoiceCommandId;
  category: VoiceCommandCategory;
  patterns: Partial<Record<SupportedLang, string[]>>;
  /** Base i18n key — lookup is `${i18nKey}.description` and `${i18nKey}.example`. */
  i18nKey: string;
  requiresConfirmation?: boolean;
}

export const VOICE_COMMANDS: VoiceCommand[] = [
  // ── Navigation ───────────────────────────────────────────────
  {
    id: 'nav.sessions',
    category: 'navigation',
    i18nKey: 'voice.commands.nav.sessions',
    patterns: {
      it: ['vai a sessioni', 'vai alle sessioni', 'apri sessioni', 'apri le sessioni', 'mostra sessioni', 'mostra le sessioni', 'vai alla sessione', 'vai a sessione', 'apri sessione', 'mostra sessione', 'mostrami sessioni', 'mostrami le sessioni', 'sessioni', 'le sessioni', 'lista sessioni'],
      en: ['go to sessions', 'open sessions', 'show sessions', 'show me sessions', 'go to session', 'open session', 'show session', 'sessions', 'session list', 'list sessions'],
      es: ['ir a sesiones', 'abrir sesiones', 'mostrar sesiones'],
      fr: ['aller aux sessions', 'ouvrir les sessions', 'afficher les sessions'],
      pt: ['ir para sessões', 'abrir sessões', 'mostrar sessões'],
    },
  },
  {
    id: 'nav.workspaces',
    category: 'navigation',
    i18nKey: 'voice.commands.nav.workspaces',
    patterns: {
      it: ['vai a workspace', 'apri workspace', 'mostra workspace', 'vai ai workspace', 'workspace', 'workspaces', 'i workspace', 'mostrami i workspace', 'lista workspace'],
      en: ['go to workspaces', 'open workspaces', 'show workspaces', 'workspaces', 'workspace', 'go to workspace', 'open workspace', 'show workspace', 'list workspaces'],
      es: ['ir a workspaces', 'abrir workspaces', 'mostrar workspaces'],
      fr: ['aller aux workspaces', 'ouvrir les workspaces', 'afficher les workspaces'],
      pt: ['ir para workspaces', 'abrir workspaces', 'mostrar workspaces'],
    },
  },
  {
    id: 'nav.settings',
    category: 'navigation',
    i18nKey: 'voice.commands.nav.settings',
    patterns: {
      it: ['vai a impostazioni', 'apri impostazioni', 'apri settings', 'vai a settings', 'impostazioni', 'settings', 'le impostazioni', 'vai alle impostazioni', 'apri le impostazioni', 'mostrami le impostazioni'],
      en: ['go to settings', 'open settings', 'show settings', 'settings', 'preferences', 'go to preferences', 'open preferences'],
      es: ['ir a ajustes', 'abrir ajustes', 'mostrar ajustes', 'abrir configuración'],
      fr: ['aller aux réglages', 'ouvrir les réglages', 'afficher les réglages', 'ouvrir paramètres'],
      pt: ['ir para ajustes', 'abrir ajustes', 'mostrar ajustes', 'abrir configurações'],
    },
  },
  {
    id: 'nav.ranking',
    category: 'navigation',
    i18nKey: 'voice.commands.nav.ranking',
    patterns: {
      it: ['vai a ranking', 'apri ranking', 'mostra ranking', 'vai a classifica', 'apri classifica', 'mostra classifica', 'ranking', 'classifica', 'la classifica', 'il ranking', 'mostrami il ranking', 'mostrami la classifica'],
      en: ['go to ranking', 'open ranking', 'show ranking', 'go to leaderboard', 'open leaderboard', 'show leaderboard', 'ranking', 'leaderboard'],
      es: ['ir a ranking', 'abrir ranking', 'mostrar ranking', 'abrir clasificación'],
      fr: ['aller au classement', 'ouvrir le classement', 'afficher le classement', 'aller au ranking'],
      pt: ['ir para ranking', 'abrir ranking', 'mostrar ranking', 'abrir classificação'],
    },
  },
  {
    id: 'nav.back',
    category: 'navigation',
    i18nKey: 'voice.commands.nav.back',
    patterns: {
      it: ['indietro', 'torna indietro', 'pagina precedente'],
      en: ['back', 'go back', 'previous page'],
      es: ['atrás', 'volver atrás', 'página anterior'],
      fr: ['retour', 'page précédente'],
      pt: ['voltar', 'página anterior'],
    },
  },
  {
    id: 'nav.forward',
    category: 'navigation',
    i18nKey: 'voice.commands.nav.forward',
    patterns: {
      it: ['avanti', 'pagina successiva'],
      en: ['forward', 'go forward', 'next page'],
      es: ['adelante', 'página siguiente'],
      fr: ['suivant', 'page suivante'],
      pt: ['avançar', 'próxima página'],
    },
  },

  // ── Session ──────────────────────────────────────────────────
  {
    id: 'session.open',
    category: 'session',
    i18nKey: 'voice.commands.session.open',
    patterns: {
      it: ['apri sessione {param}', 'apri la sessione {param}', 'sessione {param}', 'vai a sessione {param}', 'vai sulla sessione {param}', 'passa alla sessione {param}', 'mostrami la sessione {param}', 'mostra sessione {param}', 'fammi vedere la sessione {param}', 'voglio la sessione {param}', 'torna alla sessione {param}', 'porta sessione {param}', 'attiva sessione {param}', 'seleziona sessione {param}', 'scegli sessione {param}', 'apri {param}', 'apri il {param}', 'apri la {param}', 'apri lo {param}', 'vai a {param}', 'vai al {param}', 'vai sul {param}', 'vai sulla {param}', 'mostrami {param}', 'mostra {param}', 'mostrami il {param}', 'mostrami la {param}', 'voglio {param}', 'attiva {param}', 'seleziona {param}', 'passa a {param}', 'passa al {param}', 'passa alla {param}', 'porta a {param}', 'fammi vedere {param}', 'cerca {param}'],
      en: ['open session {param}', 'session {param}', 'switch to session {param}', 'go to session {param}', 'switch session {param}', 'jump to session {param}', 'show me session {param}', 'show session {param}', 'pick session {param}', 'select session {param}', 'activate session {param}', 'load session {param}', 'take me to session {param}', 'open {param}', 'go to {param}', 'show {param}', 'show me {param}', 'switch to {param}', 'jump to {param}', 'pick {param}', 'select {param}', 'activate {param}', 'load {param}', 'take me to {param}', 'find {param}'],
      es: ['abrir sesión {param}', 'abre la sesión {param}', 'sesión {param}', 'ir a sesión {param}'],
      fr: ['ouvrir session {param}', 'ouvrir la session {param}', 'session {param}', 'aller à la session {param}'],
      pt: ['abrir sessão {param}', 'abre a sessão {param}', 'sessão {param}', 'ir para sessão {param}'],
    },
  },
  {
    id: 'session.openByNumber',
    category: 'session',
    i18nKey: 'voice.commands.session.openByNumber',
    patterns: {
      it: ['sessione numero {n}', 'apri sessione numero {n}', 'apri la {n} sessione', 'la {n} sessione', 'apri {n} sessione', 'sessione {n}', 'vai alla sessione {n}', 'vai sessione {n}', 'apri sessione {n}', 'passa alla sessione {n}', 'attiva la sessione {n}', 'seleziona la sessione {n}', 'mostrami la sessione {n}'],
      en: ['session number {n}', 'open session number {n}', 'session {n}', 'go to session {n}', 'open session {n}', 'switch to session {n}', 'jump to session {n}', 'select session {n}', 'activate session {n}', 'show session {n}', 'the {n} session'],
      es: ['sesión número {n}', 'abrir sesión número {n}'],
      fr: ['session numéro {n}', 'ouvrir session numéro {n}'],
      pt: ['sessão número {n}', 'abrir sessão número {n}'],
    },
  },
  {
    id: 'session.next',
    category: 'session',
    i18nKey: 'voice.commands.session.next',
    patterns: {
      it: ['sessione successiva', 'prossima sessione', 'vai alla prossima', 'passa alla prossima sessione', 'sessione dopo', 'vai avanti di sessione'],
      en: ['next session', 'next', 'go next session', 'switch next session', 'forward session'],
      es: ['sesión siguiente', 'próxima sesión'],
      fr: ['session suivante', 'prochaine session'],
      pt: ['próxima sessão', 'sessão seguinte'],
    },
  },
  {
    id: 'session.previous',
    category: 'session',
    i18nKey: 'voice.commands.session.previous',
    patterns: {
      it: ['sessione precedente', 'vai alla precedente', 'sessione prima', 'torna indietro di sessione', 'sessione dietro'],
      en: ['previous session', 'previous', 'go previous session', 'last session', 'back session'],
      es: ['sesión anterior'],
      fr: ['session précédente'],
      pt: ['sessão anterior'],
    },
  },
  {
    id: 'session.close',
    category: 'session',
    i18nKey: 'voice.commands.session.close',
    requiresConfirmation: true,
    patterns: {
      it: ['chiudi sessione', 'chiudi la sessione'],
      en: ['close session'],
      es: ['cerrar sesión'],
      fr: ['fermer session', 'fermer la session'],
      pt: ['fechar sessão'],
    },
  },
  {
    id: 'session.new',
    category: 'session',
    i18nKey: 'voice.commands.session.new',
    patterns: {
      it: ['nuova sessione', 'crea sessione'],
      en: ['new session', 'create session'],
      es: ['nueva sesión', 'crear sesión'],
      fr: ['nouvelle session', 'créer session'],
      pt: ['nova sessão', 'criar sessão'],
    },
  },
  {
    id: 'workspace.open',
    category: 'session',
    i18nKey: 'voice.commands.workspace.open',
    patterns: {
      it: ['workspace {param}', 'apri workspace {param}', 'vai al workspace {param}'],
      en: ['workspace {param}', 'open workspace {param}', 'switch to workspace {param}'],
      es: ['workspace {param}', 'abrir workspace {param}', 'ir al workspace {param}'],
      fr: ['workspace {param}', 'ouvrir workspace {param}', 'aller au workspace {param}'],
      pt: ['workspace {param}', 'abrir workspace {param}', 'ir para workspace {param}'],
    },
  },

  // ── Focus ────────────────────────────────────────────────────
  {
    id: 'focus.subagent',
    category: 'focus',
    i18nKey: 'voice.commands.focus.subagent',
    patterns: {
      it: ['focus sub agent {n}', 'focus sub-agent {n}', 'focus subagent {n}', 'focus agente {n}', 'agente {n}', 'vai a sub agent {n}', 'passa a sub agent {n}', 'vai sul sub agent {n}', 'vai sull agente {n}', 'passa al sub agent {n}', 'passa all agente {n}', 'lavora sul sub agent {n}', 'lavora sull agente {n}', 'concentrati sul sub agent {n}', 'metti focus su agente {n}', 'metti il focus su agente {n}', 'voglio il sub agent {n}', 'voglio l agente {n}', 'seleziona agente {n}', 'seleziona sub agent {n}', 'sub agent {n}', 'sub-agent {n}', 'subagente {n}', 'agent {n}', 'attiva sub agent {n}', 'attiva agente {n}', 'apri agente {n}', 'apri sub agent {n}', 'attiva l agente {n}'],
      en: ['focus sub agent {n}', 'focus sub-agent {n}', 'focus subagent {n}', 'focus agent {n}', 'agent {n}', 'switch to sub agent {n}', 'go to sub agent {n}', 'go to agent {n}', 'switch sub agent {n}', 'work on sub agent {n}', 'work on agent {n}', 'select agent {n}', 'select sub agent {n}', 'sub-agent {n}', 'subagent {n}', 'open agent {n}', 'open sub agent {n}', 'pick agent {n}', 'pick sub agent {n}', 'jump to agent {n}', 'jump to sub agent {n}', 'activate sub agent {n}', 'activate agent {n}'],
      es: ['enfocar sub agent {n}', 'enfocar agente {n}', 'agente {n}', 'foco agente {n}'],
      fr: ['focus sub agent {n}', 'focus agent {n}', 'passer à l agent {n}', 'agent {n}'],
      pt: ['focar sub agent {n}', 'focar sub-agente {n}', 'agente {n}', 'foco agente {n}'],
    },
  },
  {
    id: 'focus.terminal',
    category: 'focus',
    i18nKey: 'voice.commands.focus.terminal',
    patterns: {
      it: ['focus terminale', 'torna al terminale', 'vai al terminale', 'vai sul terminale', 'metti il focus sul terminale', 'metti focus terminale', 'concentrati sul terminale', 'lavora sul terminale', 'apri il terminale', 'usa il terminale', 'seleziona terminale', 'voglio il terminale'],
      en: ['focus terminal', 'back to terminal', 'go to terminal', 'go to main terminal', 'switch to main terminal', 'select terminal', 'open terminal', 'use terminal', 'work on terminal', 'pick terminal'],
      es: ['enfocar terminal', 'foco terminal', 'volver al terminal'],
      fr: ['focus terminal', 'retour au terminal', 'aller au terminal'],
      pt: ['focar terminal', 'voltar ao terminal'],
    },
  },
  {
    id: 'focus.subagentNext',
    category: 'focus',
    i18nKey: 'voice.commands.focus.subagentNext',
    patterns: {
      it: ['sub agent successivo', 'prossimo sub agent', 'agente successivo', 'vai al prossimo agente', 'passa al prossimo sub agent', 'agente dopo'],
      en: ['next sub agent', 'next agent', 'next agent please', 'jump next agent'],
      es: ['siguiente sub agent', 'agente siguiente'],
      fr: ['sub agent suivant', 'agent suivant'],
      pt: ['próximo sub agent', 'agente seguinte'],
    },
  },
  {
    id: 'focus.subagentPrev',
    category: 'focus',
    i18nKey: 'voice.commands.focus.subagentPrev',
    patterns: {
      it: ['sub agent precedente', 'agente precedente', 'agente prima', 'torna all agente precedente'],
      en: ['previous sub agent', 'previous agent', 'previous agent please', 'jump previous agent'],
      es: ['sub agent anterior', 'agente anterior'],
      fr: ['sub agent précédent', 'agent précédent'],
      pt: ['sub agent anterior', 'agente anterior'],
    },
  },
  {
    id: 'focus.listAgents',
    category: 'focus',
    i18nKey: 'voice.commands.focus.listAgents',
    patterns: {
      it: ['elenco agenti', 'lista agenti', 'quanti agenti'],
      en: ['list agents', 'how many agents'],
      es: ['lista de agentes', 'cuántos agentes'],
      fr: ['liste des agents', 'combien d agents'],
      pt: ['lista de agentes', 'quantos agentes'],
    },
  },
  {
    id: 'subagent.spawn',
    category: 'focus',
    i18nKey: 'voice.commands.subagent.spawn',
    patterns: {
      it: [
        'apri un nuovo sub agent che {param}', 'apri un nuovo sub agent per {param}',
        'crea un nuovo sub agent che {param}', 'crea un nuovo sub agent per {param}',
        'crea un sub agent che {param}', 'crea un sub agent per {param}',
        'nuovo sub agent che {param}', 'nuovo sub agent per {param}',
        'spawna sub agent che {param}', 'spawna un sub agent che {param}',
        'fai un sub agent che {param}', 'fammi un sub agent che {param}',
        'apri un agente che {param}', 'crea un agente che {param}', 'crea un agente per {param}',
        'nuovo agente che {param}', 'nuovo agente per {param}', 'fammi un agente che {param}',
      ],
      en: [
        'open a new sub agent that {param}', 'open a new sub agent for {param}',
        'open new sub agent that {param}', 'open new sub agent for {param}',
        'open sub agent for {param}', 'open sub agent that {param}',
        'create a new sub agent that {param}', 'create a new sub agent for {param}',
        'create new sub agent that {param}', 'create new sub agent for {param}',
        'create a sub agent that {param}', 'create a sub agent for {param}',
        'create sub agent for {param}', 'create sub agent that {param}',
        'new sub agent that {param}', 'new sub agent for {param}',
        'spawn a sub agent that {param}', 'spawn sub agent that {param}',
        'spawn sub agent for {param}', 'spawn a sub agent for {param}',
        'make a sub agent that {param}', 'make a sub agent for {param}',
        'make sub agent for {param}', 'make sub agent that {param}',
        'open an agent that {param}', 'open an agent for {param}',
        'create an agent that {param}', 'create an agent for {param}',
        'new agent that {param}', 'new agent for {param}',
        'sub agent for {param}', 'sub agent that {param}',
      ],
    },
  },

  // ── Prompt (sends to currently focused target) ───────────────
  {
    id: 'prompt.send',
    category: 'prompt',
    i18nKey: 'voice.commands.prompt.send',
    patterns: {
      it: ['invia {param}', 'manda {param}', 'invia messaggio {param}', 'scrivigli {param}', 'digli {param}', 'mandagli {param}', 'rispondigli {param}', 'mandagli un messaggio {param}', 'gli scrivi {param}', 'spedisci {param}'],
      en: ['send {param}', 'send message {param}', 'tell it {param}', 'tell him {param}', 'reply {param}', 'reply with {param}', 'answer {param}'],
      es: ['enviar {param}', 'enviar mensaje {param}'],
      fr: ['envoyer {param}', 'envoyer message {param}'],
      pt: ['enviar {param}', 'enviar mensagem {param}'],
    },
  },
  {
    id: 'prompt.compose',
    category: 'prompt',
    i18nKey: 'voice.commands.prompt.compose',
    patterns: {
      it: ['scrivi {param}', 'componi {param}', 'prepara {param}', 'metti nel terminale {param}', 'inserisci {param}', 'digita {param}'],
      en: ['type {param}', 'compose {param}', 'write {param}', 'paste {param}', 'put {param}', 'insert {param}'],
      es: ['escribir {param}', 'componer {param}'],
      fr: ['écrire {param}', 'composer {param}'],
      pt: ['escrever {param}', 'compor {param}'],
    },
  },
  {
    id: 'prompt.run',
    category: 'prompt',
    i18nKey: 'voice.commands.prompt.run',
    requiresConfirmation: true,
    patterns: {
      it: ['esegui {param}', 'lancia {param}', 'avvia {param}', 'fai partire {param}', 'parti {param}', 'manda in esecuzione {param}', 'esegui il comando {param}', 'fai girare {param}'],
      en: ['run {param}', 'execute {param}', 'launch {param}', 'start {param}', 'kick off {param}', 'fire {param}'],
      es: ['ejecutar {param}', 'lanzar {param}'],
      fr: ['exécuter {param}', 'lancer {param}'],
      pt: ['executar {param}', 'rodar {param}'],
    },
  },
  {
    id: 'prompt.repeat',
    category: 'prompt',
    i18nKey: 'voice.commands.prompt.repeat',
    patterns: {
      it: ['ripeti ultimo comando', 'ripeti'],
      en: ['repeat last command', 'repeat last'],
      es: ['repetir último comando', 'repetir'],
      fr: ['répéter dernière commande', 'répéter'],
      pt: ['repetir último comando', 'repetir'],
    },
  },
  {
    id: 'prompt.cancelLast',
    category: 'prompt',
    i18nKey: 'voice.commands.prompt.cancelLast',
    patterns: {
      it: ['annulla ultimo', 'cancella ultimo', 'interrompi', 'ferma comando', 'ferma esecuzione', 'stop comando', 'control c', 'control-c'],
      en: ['undo last', 'cancel last', 'interrupt', 'stop command', 'kill command', 'control c', 'ctrl c'],
      es: ['cancelar último', 'interrumpir'],
      fr: ['annuler dernier', 'interrompre'],
      pt: ['cancelar último', 'interromper'],
    },
  },
  {
    id: 'prompt.clear',
    category: 'prompt',
    i18nKey: 'voice.commands.prompt.clear',
    patterns: {
      it: ['pulisci terminale', 'svuota terminale', 'cancella terminale', 'azzera terminale', 'pulisci la console', 'svuota la console'],
      en: ['clear terminal', 'clean terminal', 'clear console', 'clean console', 'wipe terminal'],
      es: ['limpiar terminal', 'borrar terminal'],
      fr: ['nettoyer terminal', 'effacer terminal'],
      pt: ['limpar terminal'],
    },
  },

  // ── Control ──────────────────────────────────────────────────
  {
    id: 'control.cancel',
    category: 'control',
    i18nKey: 'voice.commands.control.cancel',
    patterns: {
      it: ['annulla', 'stop', 'esci', 'lascia stare', 'lascia perdere', 'fermati', 'aspetta', 'no aspetta'],
      en: ['cancel', 'stop', 'exit', 'never mind', 'wait', 'hold on', 'forget it'],
      es: ['cancelar', 'parar', 'salir'],
      fr: ['annuler', 'stop', 'sortir'],
      pt: ['cancelar', 'parar', 'sair'],
    },
  },
  {
    id: 'control.repeat',
    category: 'control',
    i18nKey: 'voice.commands.control.repeat',
    patterns: {
      it: ['ripeti', 'non ho detto', 'cancella questo'],
      en: ['repeat', 'scratch that', 'undo that'],
      es: ['repetir', 'no he dicho', 'borra eso'],
      fr: ['répéter', 'oublie ça', 'efface ça'],
      pt: ['repetir', 'não disse', 'apaga isso'],
    },
  },
  {
    id: 'control.confirm',
    category: 'control',
    i18nKey: 'voice.commands.control.confirm',
    patterns: {
      it: ['conferma', 'sì', 'si', 'ok'],
      en: ['confirm', 'yes', 'ok'],
      es: ['confirmar', 'sí', 'ok'],
      fr: ['confirmer', 'oui', 'ok'],
      pt: ['confirmar', 'sim', 'ok'],
    },
  },
  {
    id: 'control.reject',
    category: 'control',
    i18nKey: 'voice.commands.control.reject',
    patterns: {
      it: ['no', 'rifiuta', 'rifiuto'],
      en: ['no', 'reject'],
      es: ['no', 'rechazar'],
      fr: ['non', 'refuser'],
      pt: ['não', 'rejeitar'],
    },
  },
  {
    id: 'control.help',
    category: 'control',
    i18nKey: 'voice.commands.control.help',
    patterns: {
      it: ['aiuto', 'che posso dire', 'mostra comandi', 'mostrami i comandi', 'che comandi ci sono', 'apri la guida', 'apri guida'],
      en: ['help', 'what can i say', 'show commands', 'show me the commands', 'open guide'],
      es: ['ayuda', 'qué puedo decir', 'mostrar comandos'],
      fr: ['aide', 'que puis-je dire', 'afficher commandes'],
      pt: ['ajuda', 'o que posso dizer', 'mostrar comandos'],
    },
  },
];

export const VOICE_COMMAND_CATEGORIES: VoiceCommandCategory[] = [
  'navigation',
  'session',
  'focus',
  'prompt',
  'control',
];
