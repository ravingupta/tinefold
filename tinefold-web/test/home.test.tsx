import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomePage } from "../src/home/HomePage";
import { removeGraph, storage } from "../src/app/sessions";

describe("home page, example brainstorm", () => {
  it("opens the example once, names it [Example], and hides the button while it exists", async () => {
    render(<HomePage />);
    await waitFor(() => screen.getByRole("button", { name: "Open the example" }));
    fireEvent.click(screen.getByRole("button", { name: "Open the example" }));
    await waitFor(() => expect(location.hash).toMatch(/^#\/?g\//));
    const id = decodeURIComponent(location.hash.replace(/^#\/?g\//, ""));
    cleanup();

    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("[Example] Tinefold Design")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open the example" })).toBeNull();
    cleanup();

    // Deleting the example brings the button back.
    await removeGraph(id);
    expect((await storage.listGraphs()).some((g) => g.id === id)).toBe(false);
    render(<HomePage />);
    await waitFor(() => screen.getByRole("button", { name: "Open the example" }));
  });
});
