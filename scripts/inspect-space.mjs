/**
 * Dev utility: print the Gradio API surface of a Hugging Face Space.
 *
 *   node scripts/inspect-space.mjs hysts/Shap-E
 *
 * Use this before wiring a new Space into lib/providers/huggingface.ts so the
 * endpoint name and parameter order are taken from the live schema rather than
 * guessed. Set HF_TOKEN first if the Space is gated or rate limited.
 */
import { Client } from "@gradio/client";

const spaces = process.argv.slice(2);
if (spaces.length === 0) {
  console.error("usage: node scripts/inspect-space.mjs <owner/space> [...]");
  process.exit(1);
}

for (const space of spaces) {
  console.log("\n==================================================");
  console.log("SPACE:", space);
  console.log("==================================================");
  try {
    const client = await Client.connect(space, {
      hf_token: process.env.HF_TOKEN || undefined,
    });
    console.log(JSON.stringify(await client.view_api(), null, 2));
  } catch (error) {
    console.log("ERROR:", error?.message ?? String(error));
  }
}
process.exit(0);
