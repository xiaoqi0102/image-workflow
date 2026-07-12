import { fhlResponsesAdapter } from "./fhl-responses.mjs";
import { openaiImagesAdapter } from "./openai-images.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

const adapters = new Map([[openaiImagesAdapter.id, openaiImagesAdapter], [fhlResponsesAdapter.id, fhlResponsesAdapter]]);

export function getAdapter(id) {
  const adapter = adapters.get(id);
  if (!adapter) throw new ImageWorkflowError(`未知 adapter: ${id}`, "ADAPTER_NOT_FOUND");
  return adapter;
}
