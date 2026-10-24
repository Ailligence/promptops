import { Injectable, signal } from "@angular/core";

/**
 * Network state of the device, from the browser `online`/`offline` events.
 *
 * The app's own data lives on this device and never needs the network, but
 * the agent CLIs do: the layout shows a banner while the device is offline.
 */
@Injectable({ providedIn: "root" })
export class OfflineService {
  /** True when the device is (probably) online. */
  readonly online = signal<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine !== false : true
  );

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.online.set(true));
      window.addEventListener("offline", () => this.online.set(false));
    }
  }
}
