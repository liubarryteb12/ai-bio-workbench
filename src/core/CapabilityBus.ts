import type { CapabilityContract, ExitCode } from './types';

export interface Capability {
  readonly id: string;
  readonly ownerModule: string;
  readonly version: string;
  readonly executeReadOnly?: CapabilityContract['executeReadOnly'];
}

export interface CapabilityQueryResult<TResponse = unknown> {
  readonly exitCode: ExitCode;
  readonly data?: Readonly<TResponse>;
  readonly error?: string;
}

export interface CapabilityEvent {
  type: string;
  payload?: unknown;
}

type CapabilityHandler = (event: CapabilityEvent) => void;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export class CapabilityBus {
  private readonly capabilities = new Map<string, Capability>();
  private readonly handlers = new Map<string, Set<CapabilityHandler>>();

  registerCapability(capability: Capability): ExitCode;
  registerCapability(providerModId: string, contract: CapabilityContract): ExitCode;
  registerCapability(
    capabilityOrOwner: Capability | string,
    contract?: CapabilityContract
  ): ExitCode {
    const capability: Capability = typeof capabilityOrOwner === 'string'
      ? {
          id: contract?.capabilityId ?? '',
          ownerModule: capabilityOrOwner,
          version: contract?.version ?? '',
          executeReadOnly: contract?.executeReadOnly,
        }
      : capabilityOrOwner;
    if (!capability.id || !capability.ownerModule || !capability.version) {
      throw new Error('ERR_CAPABILITY_INCOMPLETE');
    }
    this.capabilities.set(capability.id, Object.freeze({ ...capability }));
    return 0;
  }

  requireCapability(id: string): Capability {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new Error(`ERR_CAPABILITY_MISSING: ${id}`);
    }
    return capability;
  }

  async query<
    TRequest extends Record<string, unknown>,
    TResponse = unknown,
  >(
    capabilityId: string,
    request: Readonly<TRequest>
  ): Promise<CapabilityQueryResult<TResponse>> {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) {
      return Object.freeze({
        exitCode: 2,
        error: `ERR_CAPABILITY_MISSING: ${capabilityId}`,
      });
    }
    if (typeof capability.executeReadOnly !== 'function') {
      return Object.freeze({
        exitCode: 2,
        error: `ERR_CAPABILITY_NOT_QUERYABLE: ${capabilityId}`,
      });
    }
    if (request === null || typeof request !== 'object' || Array.isArray(request)) {
      return Object.freeze({
        exitCode: 2,
        error: `ERR_CAPABILITY_REQUEST_INVALID: ${capabilityId}`,
      });
    }
    try {
      const data = await capability.executeReadOnly(
        deepFreeze({ ...request }) as Readonly<TRequest>
      );
      return Object.freeze({
        exitCode: 0,
        data: deepFreeze(data) as Readonly<TResponse>,
      });
    } catch (cause) {
      return Object.freeze({
        exitCode: 1,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
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
