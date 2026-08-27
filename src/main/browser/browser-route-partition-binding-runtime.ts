import { app } from 'electron'
import { join } from 'node:path'
import { BrowserRoutePartitionBindingStore } from './browser-route-partition-binding-store'

const BINDING_FILE_NAME = 'browser-route-partition-bindings.json'
const PARTITION_DATA_DIRECTORY_NAME = 'Partitions'
let bindingFilePathOverride: string | null = null
let activeMantaProfileId: string | null = null

export function configureBrowserRoutePartitionBindingsForMantaProfile(options: {
  mantaProfileId: string
  profileDirectory: string
}): void {
  bindingFilePathOverride = join(options.profileDirectory, BINDING_FILE_NAME)
  activeMantaProfileId = options.mantaProfileId
}

/** Null before the active Manta profile is known, when no partition can exist yet. */
export function activeBrowserRoutePartitionOrcaProfileId(): string | null {
  return activeMantaProfileId
}

export function routePartitionDataRoot(): string {
  return join(app.getPath('userData'), PARTITION_DATA_DIRECTORY_NAME)
}

export function currentBrowserRoutePartitionBindingStore(options?: {
  isPartitionRetained?: (partition: string) => boolean
}): BrowserRoutePartitionBindingStore {
  return new BrowserRoutePartitionBindingStore({
    filePath: bindingFilePathOverride ?? join(app.getPath('userData'), BINDING_FILE_NAME),
    partitionDataRoot: routePartitionDataRoot(),
    isPartitionRetained: options?.isPartitionRetained
  })
}
