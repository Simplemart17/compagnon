import React, { useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { flushWriteQueue } from "@/src/lib/cache";
import { supabase } from "@/src/lib/supabase";

export const NetworkBanner = React.memo(function NetworkBanner() {
  const [isConnected, setIsConnected] = useState(true);
  const wasDisconnected = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? true;
      setIsConnected(connected);

      if (!connected) {
        wasDisconnected.current = true;
      } else if (wasDisconnected.current) {
        // Network just came back -- flush any queued offline writes
        wasDisconnected.current = false;
        void flushWriteQueue(supabase);
      }
    });
    return unsubscribe;
  }, []);

  if (isConnected) return null;

  return (
    <View className="items-center bg-error px-4 py-1.5">
      <Text className="text-xs font-semibold text-white">No internet connection</Text>
    </View>
  );
});
