const ICE_SERVERS_PATH = '/rooms/ice-servers';
// Las credenciales TURN vencen en una hora: se renuevan antes, mientras la llamada siga.
export const RENEW_INTERVAL_MS = 45 * 60 * 1000;

// De donde salen los servidores ICE de cada llamada. Al contestar o al ser aceptado se piden
// al servidor (con TURN traen credenciales recien emitidas que vencen solas); si no responde,
// se usan los STUN que llegaron con la bienvenida.
export class IceServerSource {
  #request;
  #schedule;
  #welcomeServers = [];

  constructor(request, schedule) {
    this.#request = request;
    this.#schedule = schedule;
  }

  useWelcomeServers(iceServers) {
    this.#welcomeServers = iceServers;
  }

  async forCall() {
    return (await this.#fetch()) ?? this.#welcomeServers;
  }

  // Renueva las credenciales de una llamada en curso hasta que deje de estarlo. Si el servidor
  // no responde, conserva las que tiene: cambiarlas por solo STUN cortaria una llamada retransmitida.
  keepRenewed(link, isCurrent) {
    this.#schedule(async () => {
      if (!isCurrent()) {
        return;
      }
      const iceServers = await this.#fetch();
      if (iceServers && isCurrent()) {
        link.updateIceServers(iceServers);
      }
      this.keepRenewed(link, isCurrent);
    }, RENEW_INTERVAL_MS);
  }

  async #fetch() {
    try {
      const response = await this.#request(ICE_SERVERS_PATH);
      if (!response.ok) {
        return null;
      }
      const { iceServers } = await response.json();
      return Array.isArray(iceServers) ? iceServers : null;
    } catch {
      return null;
    }
  }
}
