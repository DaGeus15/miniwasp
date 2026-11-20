import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from './limits.js';

const NAME_ERRORS = { empty: 'nameRequired', tooLong: 'nameTooLong' };
const TEXT_ERRORS = { empty: 'textRequired', tooLong: 'textTooLong' };

function lengthErrorKey(value, maxLength, errorKeys) {
  if (value.length === 0) {
    return errorKeys.empty;
  }
  return value.length > maxLength ? errorKeys.tooLong : null;
}

export function validateName(rawName) {
  const name = rawName.trim();
  const errorKey = lengthErrorKey(name, MAX_NAME_LENGTH, NAME_ERRORS);
  return errorKey ? { errorKey } : { name };
}

// Con un adjunto el texto es un pie de foto: puede quedar vacio, pero no superar el limite.
function textErrorKey(text, isTextOptional) {
  if (isTextOptional && text.length === 0) {
    return null;
  }
  return lengthErrorKey(text, MAX_TEXT_LENGTH, TEXT_ERRORS);
}

export function validateDraft({ name, text }, { isTextOptional = false } = {}) {
  const draft = { name: name.trim(), text: text.trim() };
  const errorKey =
    lengthErrorKey(draft.name, MAX_NAME_LENGTH, NAME_ERRORS) ?? textErrorKey(draft.text, isTextOptional);

  return errorKey ? { errorKey } : { draft };
}
