// textContent evita XSS: el contenido de otros usuarios nunca se interpreta como HTML.
export function createTextElement(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
