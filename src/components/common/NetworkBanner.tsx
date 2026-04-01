import React, { useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { flushWriteQueue } from "@/src/lib/cache";
import { supabase } from "@/src/lib/supabase";

const DEBOUNCE_MS = 5000;

export const NetworkBanner = React.memo(function NetworkBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const wasDisconnected = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasReceivedFirstEvent = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? true;

      // Flush write queue immediately on reconnection (not debounced)
      if (connected && wasDisconnected.current) {
        wasDisconnected.current = false;
        void flushWriteQueue(supabase);
      }

      if (!connected) {
        wasDisconnected.current = true;
      }

      // First event: show banner immediately if offline (no debounce delay)
      if (!hasReceivedFirstEvent.current) {
        hasReceivedFirstEvent.current = true;
        setShowBanner(!connected);
        return;
      }

      // Subsequent events: debounce to avoid flicker on flaky connections
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        setShowBanner(!connected);
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  if (!showBanner) return null;

  return (
    <View className="items-center bg-error px-4 py-1.5">
      <Text className="text-xs font-semibold text-white">No internet connection</Text>
    </View>
  );
});
