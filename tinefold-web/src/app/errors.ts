import { isEngineError } from "@ravingupta/tinefold-engine";

export interface UiError {
  message: string;
  action?: "settings" | "retry";
}

/** Every EngineError code maps to a message and a recovery action. Raw messages stay in the console. */
export function toUiError(e: unknown): UiError {
  console.error(e);
  if (!isEngineError(e)) return { message: "Something went wrong. Try again.", action: "retry" };
  switch (e.code) {
    case "ProviderFailed": {
      const msg = e.message;
      if (/key is not set/i.test(msg)) return { message: "No API key for this model. Add one in Settings, or switch to demo mode.", action: "settings" };
      if (/401|403|invalid.*key|authentication/i.test(msg)) return { message: "The provider rejected your API key. Check it in Settings.", action: "settings" };
      if (/no provider/i.test(msg)) return { message: "No provider is set for this step. Pick one in Settings.", action: "settings" };
      if (/429|rate/i.test(msg)) return { message: "The provider is rate limiting. Wait a moment and try again.", action: "retry" };
      if (/network|fetch/i.test(msg)) return { message: "Could not reach the provider. Check your connection.", action: "retry" };
      return { message: `The model call failed: ${msg.replace(/^\w+ returned \d+: /, "").slice(0, 160)}`, action: "retry" };
    }
    case "ValidationFailed":
      if (/failed validation twice/.test(e.message)) return { message: "The model's answer didn't fit the expected shape twice in a row. Try again, or use a stronger model.", action: "retry" };
      return { message: e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." };
    case "ContextTooLarge":
      return { message: "This brainstorm has grown past the context limit. Fold comments into the problem or prune finished branches." };
    case "SeqConflict":
      return { message: "This graph changed in another tab. Reload the page to continue.", action: "retry" };
    case "InvalidSelection":
      return { message: "That choice isn't available here any more. The tree has been refreshed." };
  }
}
