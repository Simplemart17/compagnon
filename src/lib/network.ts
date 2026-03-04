/**
 * Network Connectivity Utilities
 *
 * Provides a simple check for internet connectivity
 * and a hook for reactive connectivity state.
 */

import NetInfo from "@react-native-community/netinfo";

/** Check if the device currently has internet connectivity */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** Throw if the device is offline */
export async function requireNetwork(): Promise<void> {
  const online = await isOnline();
  if (!online) {
    throw new Error("No internet connection. Please check your network and try again.");
  }
}
