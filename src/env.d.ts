import type { VeltriteAPI } from "../shared/types";
declare global {
  interface Window {
    veltrite: VeltriteAPI;
  }
}
export {};
