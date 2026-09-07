"use client";

import { useCallback, useEffect, useState } from "react";

/* ── Provider definitions ─────────────────────────────────── */

export type ProviderKey = "gemini" | "chatgpt" | "openrouter" | "grok" | "claude";

export type ApiProviderConfig = {
  provider: ProviderKey;
  apiKey: string;
  model: string;
  label: string;
};

export type ApiConfig = {
  activeProvider: ProviderKey;
  providers: ApiProviderConfig[];
};

export const PROVIDER_OPTIONS: { key: ProviderKey; label: string; defaultModel: string; models: string[] }[] = [
  {
    key: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"],
  },
  {
    key: "chatgpt",
    label: "OpenAI ChatGPT",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    defaultModel: "openai/gpt-4o",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.0-flash",
      "meta-llama/llama-3.1-70b-instruct",
    ],
  },
  {
    key: "grok",
    label: "xAI Grok",
    defaultModel: "grok-3",
    models: ["grok-3", "grok-3-mini", "grok-2"],
  },
  {
    key: "claude",
    label: "Anthropic Claude",
    defaultModel: "claude-sonnet-4-20250514",
    models: [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
    ],
  },
];

/* ── Storage keys ─────────────────────────────────────────── */

const OPS_CONFIG_KEY = "zenvora-ops-api-config";
const SHELL_CONFIG_KEY = "zenvora-shell-api-config";

/* ── Default config ───────────────────────────────────────── */

function buildDefaultConfig(): ApiConfig {
  return {
    activeProvider: "gemini",
    providers: PROVIDER_OPTIONS.map((p) => ({
      provider: p.key,
      apiKey: "",
      model: p.defaultModel,
      label: p.label,
    })),
  };
}

/* ── Read / Write helpers ─────────────────────────────────── */

function readConfig(key: string): ApiConfig {
  if (typeof window === "undefined") return buildDefaultConfig();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return buildDefaultConfig();
    const parsed = JSON.parse(raw) as ApiConfig;
    // Ensure all providers exist (in case new ones were added)
    const existing = new Set(parsed.providers.map((p) => p.provider));
    for (const opt of PROVIDER_OPTIONS) {
      if (!existing.has(opt.key)) {
        parsed.providers.push({
          provider: opt.key,
          apiKey: "",
          model: opt.defaultModel,
          label: opt.label,
        });
      }
    }
    return parsed;
  } catch {
    return buildDefaultConfig();
  }
}

function writeConfig(key: string, config: ApiConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(config));
}

/* ── Public getters (non-hook, for one-off reads) ─────────── */

export function getOpsApiConfig(): ApiConfig {
  return readConfig(OPS_CONFIG_KEY);
}

export function getShellApiConfig(): ApiConfig {
  // Shell inherits from ops if no local shell override exists
  if (typeof window !== "undefined" && window.localStorage.getItem(SHELL_CONFIG_KEY)) {
    return readConfig(SHELL_CONFIG_KEY);
  }
  return readConfig(OPS_CONFIG_KEY);
}

export function getActiveProviderConfig(config: ApiConfig): ApiProviderConfig | undefined {
  return config.providers.find((p) => p.provider === config.activeProvider);
}

/* ── Hook ──────────────────────────────────────────────────── */

export function useApiConfig(scope: "ops" | "shell" = "ops") {
  const storageKey = scope === "shell" ? SHELL_CONFIG_KEY : OPS_CONFIG_KEY;

  const [config, setConfig] = useState<ApiConfig>(() => {
    if (scope === "shell") return getShellApiConfig();
    return readConfig(storageKey);
  });

  // Persist whenever config changes
  useEffect(() => {
    writeConfig(storageKey, config);
  }, [config, storageKey]);

  const setActiveProvider = useCallback((provider: ProviderKey) => {
    setConfig((prev) => ({ ...prev, activeProvider: provider }));
  }, []);

  const setProviderApiKey = useCallback((provider: ProviderKey, apiKey: string) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((p) =>
        p.provider === provider ? { ...p, apiKey } : p
      ),
    }));
  }, []);

  const setProviderModel = useCallback((provider: ProviderKey, model: string) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((p) =>
        p.provider === provider ? { ...p, model } : p
      ),
    }));
  }, []);

  const activeProvider = config.providers.find(
    (p) => p.provider === config.activeProvider
  );

  /** Providers that have an API key configured */
  const configuredProviders = config.providers.filter(
    (p) => p.apiKey.trim().length > 0
  );

  return {
    config,
    setConfig,
    activeProvider,
    configuredProviders,
    setActiveProvider,
    setProviderApiKey,
    setProviderModel,
  };
}
