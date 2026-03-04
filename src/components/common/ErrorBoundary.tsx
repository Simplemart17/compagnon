import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import { captureError } from "@/src/lib/sentry";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    captureError(error, "error-boundary", { componentStack: errorInfo.componentStack });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View
          style={{
            flex: 1,
            backgroundColor: "#F5F5F0",
            justifyContent: "center",
            alignItems: "center",
            padding: 32,
          }}
        >
          <Text style={{ fontSize: 48, marginBottom: 16 }}>{"\u26A0\uFE0F"}</Text>
          <Text
            style={{
              fontSize: 20,
              fontWeight: "700",
              color: "#1E3A5F",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Something went wrong
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#666",
              textAlign: "center",
              marginBottom: 24,
              lineHeight: 20,
            }}
          >
            {this.state.error?.message ?? "An unexpected error occurred."}
          </Text>
          <TouchableOpacity
            onPress={this.handleRetry}
            style={{
              backgroundColor: "#1E3A5F",
              borderRadius: 12,
              paddingHorizontal: 32,
              paddingVertical: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
