import { Redirect } from "expo-router";

export default function Index() {
  // Root layout handles auth-based routing
  return <Redirect href="/(tabs)/home" />;
}
