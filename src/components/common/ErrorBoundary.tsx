import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import { Colors } from "@/src/lib/design";
import { captureError } from "@/src/lib/sentry";
import { Icon } from "@/src/components/common/Icon";

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
    captureError(error, "error-boundary", {
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View className="flex-1 items-center justify-center bg-surface p-8">
          <View className="mb-4">
            <Icon name="alert-triangle" size={48} color={Colors.error} />
          </View>
          <Text className="mb-2 text-center text-xl font-bold text-primary">
            Something went wrong
          </Text>
          <Text
            className="mb-6 text-center text-sm leading-5"
            style={{ color: Colors.textSecondary }}
          >
            {this.state.error?.message ?? "An unexpected error occurred."}
          </Text>
          <TouchableOpacity
            onPress={this.handleRetry}
            className="rounded-xl bg-primary px-8 py-3.5"
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text className="text-base font-semibold text-white">Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
