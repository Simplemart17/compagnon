import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Platform } from "react-native";

type ExternalLinkProps = React.ComponentProps<typeof Link> & {
  href: string;
};

export function ExternalLink(props: ExternalLinkProps) {
  return (
    <Link
      target="_blank"
      {...props}
      // href is cast here because this component is specifically for external
      // URLs (https://...) which are valid ExternalPathString values accepted
      // by the typed-routes href union, but TypeScript cannot narrow `string`
      // to that subtype without an explicit assertion.
      href={props.href as React.ComponentProps<typeof Link>["href"]}
      onPress={(e) => {
        if (Platform.OS !== "web") {
          // Prevent the default behavior of linking to the default browser on native.
          e.preventDefault();
          // Open the link in an in-app browser.
          void WebBrowser.openBrowserAsync(props.href);
        }
      }}
    />
  );
}
