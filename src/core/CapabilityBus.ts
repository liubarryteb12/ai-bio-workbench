export interface Capability {
  id: string;
  ownerModule: string;
  version: string;
}

export interface CapabilityEvent {
  type: string;
  payload?: unknown;
}

type CapabilityHandler = (event: CapabilityEvent) => void;

export class CapabilityBus {
  private readonly capabilities = new Map<string, Capability>();
  private readonly handlers = new Map<string, Set<CapabilityHandler>>();

  registerCapability(capability: Capability): void {
    if (!capability.id || !capability.ownerModule || !capability.version) {
      throw new Error('ERR_CAPABILITY_INCOMPLETE');
    }
    this.capabilities.set(capability.id, capability);
  }

  requireCapability(id: string): Capability {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new Error(`ERR_CAPABILITY_MISSING: ${id}`);
    }
    return capability;
  }

  subscribe(type: string, handler: CapabilityHandler): () => void {
    const existing = this.handlers.get(type) ?? new Set<CapabilityHandler>();
    existing.add(handler);
    this.handlers.set(type, existing);
    return () => existing.delete(handler);
  }

  publish(event: CapabilityEvent): number {
    const listeners = this.handlers.get(event.type);
    if (!listeners) {
      return 0;
    }
    for (const handler of listeners) {
      handler(event);
    }
    return listeners.size;
  }
}
