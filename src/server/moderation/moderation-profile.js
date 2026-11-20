import { ATTACHMENT_TYPES } from '../../shared/attachments.js';
import { ModerationLevel } from './moderation-terms.js';

const ALL_TYPES = ATTACHMENT_TYPES.map((type) => type.mimeType);
// Lo que la moderacion puede revisar por dentro: fotos y texto. Notas de voz y PDF no.
const REVIEWABLE_TYPES = ['image/jpeg', 'text/plain'];

// Reglas de moderacion de una sala. Reune en un solo valor todo lo que cambia entre una sala
// privada y una publica, para que ninguna otra pieza tenga que preguntar de que tipo es.
export class ModerationProfile {
  constructor({ name, textLevel, imageThresholds, allowedTypes, strikesToMute, reportsToRemove, slowModeMs, bansExpelled }) {
    this.name = name;
    this.textLevel = textLevel;
    this.imageThresholds = Object.freeze({ ...imageThresholds });
    this.allowedTypes = Object.freeze([...allowedTypes]);
    this.strikesToMute = strikesToMute;
    this.reportsToRemove = reportsToRemove;
    this.slowModeMs = slowModeMs;
    this.bansExpelled = bansExpelled;
    Object.freeze(this);
  }

  allowsType(mimeType) {
    return this.allowedTypes.includes(mimeType);
  }
}

export const ModerationProfiles = Object.freeze({
  // Salas privadas por invitacion: se bloquea lo grave y se permiten las groserias comunes.
  STANDARD: new ModerationProfile({
    name: 'standard',
    textLevel: ModerationLevel.STANDARD,
    imageThresholds: { explicit: 0.7, suggestive: 0.9 },
    allowedTypes: ALL_TYPES,
    strikesToMute: 3,
    reportsToRemove: 3,
    slowModeMs: 0,
    bansExpelled: false,
  }),
  // Salas publicas y susurros entre desconocidos: apto para todo publico.
  STRICT: new ModerationProfile({
    name: 'strict',
    textLevel: ModerationLevel.STRICT,
    imageThresholds: { explicit: 0.5, suggestive: 0.6 },
    allowedTypes: REVIEWABLE_TYPES,
    strikesToMute: 2,
    reportsToRemove: 2,
    slowModeMs: 2000,
    bansExpelled: true,
  }),
});
