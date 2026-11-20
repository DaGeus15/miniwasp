// Una sala esta en uso mientras tenga conexiones del navegador o sesiones abiertas de la API
// (las sesiones de la API tienen nombre; las del navegador lo eligen por WebSocket). Solo una
// sala sin uso entra en su tiempo de gracia antes de cerrarse.
export function isRoomInUse({ peers, sessions }, roomId) {
  return (
    peers.hasMembers(roomId) ||
    sessions.findWhere((session) => session.roomId === roomId && typeof session.name === 'string').length > 0
  );
}
