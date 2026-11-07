// @vitest-environment jsdom
//
// Renders the real questionnaire component. It lives in lib/ only because
// vitest collects lib/**/*.test.ts and app/**/*.test.ts; it is written with
// createElement (no JSX) for the same reason.
import { afterEach, describe, expect, it } from "vitest";
import { createElement, type ComponentProps, type FunctionComponent } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ObstetricQuestionnaireFields } from "@/components/ObstetricQuestionnaireFields";
import { messages } from "@/lib/i18n/messages";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/config";

afterEach(cleanup);

// createElement takes children as extra arguments (JSX-free file), so type the provider without a `children` prop.
const Provider = I18nProvider as unknown as FunctionComponent<Omit<ComponentProps<typeof I18nProvider>, "children">>;

function mount(locale: Locale = "en") {
  const form = createElement("form", { "data-testid": "form" }, createElement(ObstetricQuestionnaireFields));
  return render(createElement(Provider, { locale, messages: messages[locale] }, form));
}

/** What the browser would POST for this form. */
function submitted(): Record<string, string> {
  const data = new FormData(screen.getByTestId("form") as HTMLFormElement);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)]));
}

/** The numbers printed next to the questions, top to bottom. */
function printedNumbers(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("ol > li")].map((li) => li.querySelector("p > span")?.textContent ?? null);
}

describe("ObstetricQuestionnaireFields", () => {
  it("renumbers itself: 1-4 for a primigravida, 1-7 after a prior delivery, 1-4 again after switching back", () => {
    const { container } = mount();
    expect(printedNumbers(container)).toEqual(["1.", "2.", "3.", "4."]);
    expect(screen.getByText(/^4 clinical questions/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Normal vaginal/ }));
    expect(printedNumbers(container)).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7."]);
    expect(screen.getByText(/^7 clinical questions/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /First pregnancy/ }));
    expect(printedNumbers(container)).toEqual(["1.", "2.", "3.", "4."]);

    // The questions that remain keep their meaning, just a new number.
    const labels = [...container.querySelectorAll("ol > li")].map((li) => li.querySelector("p > span:last-child")?.textContent);
    expect(labels).toEqual([
      "Previous delivery mode & type",
      "Past pregnancy loss",
      "Family pregnancy & genetic history",
      "Pre-existing chronic medical conditions",
    ]);
  });

  it("submits nothing for hidden questions and resets them when switching back to Primi", () => {
    mount();
    expect(Object.keys(submitted()).sort()).toEqual([
      "q_chronicConditions",
      "q_doctorNotes",
      "q_familyComplications",
      "q_pastPregnancyLoss",
      "q_previousDeliveryMode",
    ]);

    fireEvent.click(screen.getByRole("radio", { name: /Normal vaginal/ }));
    let fields = submitted();
    expect(fields.q_pastBirthWeight).toBe("normal");
    expect(fields.q_interpregnancyInterval).toBe("18m-5y");
    expect(JSON.parse(fields.q_priorComplications)).toEqual(["none"]);

    // Tick pre-eclampsia under a prior delivery, then switch back to Primi (the bug).
    fireEvent.click(screen.getByRole("checkbox", { name: /Pre-eclampsia \/ high BP/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Severe bleeding/ }));
    expect(JSON.parse(submitted().q_priorComplications)).toEqual(["preeclampsia", "pph"]);

    fireEvent.click(screen.getByRole("radio", { name: /First pregnancy/ }));
    fields = submitted();
    expect(fields).not.toHaveProperty("q_priorComplications");
    expect(fields).not.toHaveProperty("q_pastBirthWeight");
    expect(fields).not.toHaveProperty("q_interpregnancyInterval");
    expect(JSON.stringify(fields)).not.toContain("preeclampsia");

    // Switching away again starts from a clean slate, not the old ticks.
    fireEvent.click(screen.getByRole("radio", { name: /Previous C-section/ }));
    expect(JSON.parse(submitted().q_priorComplications)).toEqual(["none"]);
  });

  it("keeps 'None' exclusive in multi-select questions", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: /Normal vaginal/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Gestational diabetes/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Severe bleeding/ }));
    expect(JSON.parse(submitted().q_priorComplications)).toEqual(["gdm", "pph"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /None \/ uneventful/ }));
    expect(JSON.parse(submitted().q_priorComplications)).toEqual(["none"]);
    expect(screen.getByRole("checkbox", { name: /Gestational diabetes/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("uses a semantic ordered list, labelled groups and a polite live region", () => {
    const { container } = mount();
    expect(screen.getByRole("list", { name: "Clinical questions" }).tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("radiogroup", { name: "Previous delivery mode & type" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Pre-existing chronic medical conditions" })).toBeTruthy();

    const live = container.querySelector("[aria-live='polite']");
    expect(live?.textContent).toBe("Showing 4 questions");
    fireEvent.click(screen.getByRole("radio", { name: /Instrumental/ }));
    expect(live?.textContent).toBe("Showing 7 questions");
  });

  it("the header is one real button wired to the panel it controls", () => {
    mount();
    const toggle = screen.getByRole("button", { name: /Past pregnancy history & clinical questionnaire/ });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.querySelector("button, [role='button']")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel?.hidden).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    // Collapsing does not drop the answers.
    expect(submitted().q_previousDeliveryMode).toBe("Primi");
  });

  it("choice groups are a radio group with a roving tabindex and arrow-key selection", () => {
    mount();
    const radios = within(screen.getByRole("radiogroup", { name: "Previous delivery mode & type" })).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios[1]);
    expect(submitted().q_previousDeliveryMode).toBe("NVD");

    fireEvent.keyDown(radios[1], { key: "ArrowLeft" });
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" }); // wraps to the last option
    expect(radios[3].getAttribute("aria-checked")).toBe("true");
    expect(submitted().q_previousDeliveryMode).toBe("Instrumental");
  });

  it("submits the notes sanitised and capped through a hidden field", () => {
    mount();
    const input = screen.getByLabelText(/Clinician high-risk observations/) as HTMLInputElement;
    expect(input.getAttribute("name")).toBeNull();
    expect(input.maxLength).toBe(500);
    fireEvent.change(input, { target: { value: "  Scar\u0007 ok  " } });
    expect(submitted().q_doctorNotes).toBe("Scar ok");
  });

  it.each(["hi", "mr"] as const)("shows %s text only: no English labels and no raw message keys", (locale) => {
    const { container } = mount(locale);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    const text = container.textContent ?? "";
    expect(text).toMatch(/[ऀ-ॿ]/);
    expect(text).not.toMatch(/patients\.questionnaire/);
    expect(text).not.toMatch(/Previous delivery|Normal vaginal|Feeds 1-page|clinical questions/);
    expect(printedNumbers(container)).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7."]);
  });
});
