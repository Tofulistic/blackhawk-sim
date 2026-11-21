// Standalone build: the live phone-link pairing is not available, so this is an inert stand-in.
export const SITE_URL = '';
export const newCode = () => '';
export class PhoneLink {
  constructor() { this.status = 'off'; this.state = null; this.everConnected = false; this.onstatus = null; this.onevent = null; }
  get fresh() { return false; }
  async host() { return false; }
  tell() {}
  async stop() {}
}
export function runPadPage() {}
