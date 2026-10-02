"use client";

import { MAX_PROMPT_LENGTH } from "@/lib/types";

/** Starter prompts that reliably produce a recognisable mesh. */
export const EXAMPLE_PROMPTS = [
  "a red sports car",
  "a wooden chair",
  "a cute robot",
  "a medieval sword",
] as const;

interface PromptFormProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  isGenerating: boolean;
}

export default function PromptForm({
  prompt,
  onPromptChange,
  onSubmit,
  isGenerating,
}: PromptFormProps) {
  const tooLong = prompt.length > MAX_PROMPT_LENGTH;
  const canSubmit = prompt.trim().length > 0 && !tooLong && !isGenerating;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <label
          htmlFor="prompt"
          className="text-sm font-medium text-slate-200"
        >
          Describe your 3D object
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits; Shift+Enter keeps a newline.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          rows={4}
          maxLength={MAX_PROMPT_LENGTH + 50}
          disabled={isGenerating}
          placeholder="a brass steampunk telescope on a tripod"
          aria-describedby="prompt-counter"
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
        />
        <p
          id="prompt-counter"
          className={`self-end text-xs tabular-nums ${
            tooLong ? "text-rose-400" : "text-slate-500"
          }`}
        >
          {prompt.length}/{MAX_PROMPT_LENGTH}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Try an example
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              disabled={isGenerating}
              onClick={() => onPromptChange(example)}
              className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:border-sky-600 hover:text-sky-300 disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        {isGenerating ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Generating…
          </>
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 3v4M3 5h4m10 10v4m-2-2h4M9.5 3.5 11 8l4.5 1.5L11 11l-1.5 4.5L8 11l-4.5-1.5L8 8l1.5-4.5Zm8.5 2L19 7l1 1-1 1-1-1 1-1Z"
              />
            </svg>
            Generate 3D model
          </>
        )}
      </button>
    </form>
  );
}
