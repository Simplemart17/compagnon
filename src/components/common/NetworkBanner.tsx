import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import NetInfo from "@react-native-community/netinfo";

export function NetworkBanner() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? true);
    });
    return unsubscribe;
  }, []);

  if (isConnected) return null;

  return (
    <View
      style={{
        backgroundColor: "#FF3B30",
        paddingVertical: 6,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>
        No internet connection
      </Text>
    </View>
  );
}
