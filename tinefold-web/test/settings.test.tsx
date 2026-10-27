import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { updateSettings } from "../src/app/sessions";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings/settings";
import { SettingsPage } from "../src/settings/SettingsPage";

describe("settings page", () => {
  afterEach(() => updateSettings({ ...DEFAULT_SETTINGS }));

  it("shows what is in use, flags unsaved edits, and offers real model choices", () => {
    render(<SettingsPage />);
    const inUse = () => within(screen.getByRole("region", { name: "In use now" }));
    expect(inUse().getByText(/Demo mode/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(Array.from(model.options).map((o) => o.value)).toContain("claude-opus-5-5");
    fireEvent.change(model, { target: { value: "claude-opus-5-5" } });
    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-test-abcd" } });

    // Nothing applies until saved, and the page says so.
    expect(inUse().getByText(/Demo mode/)).toBeTruthy();
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    expect(screen.getByText("New key, not saved yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(inUse().getByText("Anthropic · Claude Opus 5.5 · strongest")).toBeTruthy();
    expect(inUse().getByText(/Anthropic key saved \(…abcd\)/)).toBeTruthy();
    expect(screen.getByText(/Saved in this browser · ends in abcd/)).toBeTruthy();
    expect(loadSettings()).toMatchObject({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", anthropicKey: "sk-ant-test-abcd" });
  });

  it("accepts a model ID outside the suggestions", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("radio", { name: /OpenAI-compatible/ }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "__custom" } });
    fireEvent.change(screen.getByLabelText("Model: custom model ID"), { target: { value: "llama-4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(loadSettings().defaultModel).toBe("llama-4");
  });
});
