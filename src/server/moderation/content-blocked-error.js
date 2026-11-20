import { ValidationError } from '../validation.js';
import { moderationReason } from './text-moderator.js';

// Rechazo por moderacion: hereda de ValidationError para que su mensaje llegue al usuario,
// y conserva la categoria para decidir advertencias, silencios o expulsiones.
export class ContentBlockedError extends ValidationError {
  name = 'ContentBlockedError';

  constructor(category, message = `No se envió: ${moderationReason(category)}`) {
    super(message);
    this.category = category;
  }
}
